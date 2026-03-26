# stream-tts Assessment

## Module Overview

`stream-tts.ts` implements a streaming text-to-speech (TTS) pipeline that converts text to audio and plays it through the system speakers with minimal latency. It uses the Kokoro-82M ONNX model (via the `kokoro-js` library) to synthesize speech, and pipes the raw PCM audio output directly to `ffplay` for real-time playback.

The key design goal is low perceived latency: rather than waiting for the entire text to be synthesized before playing, it uses a producer/consumer streaming architecture where audio chunks begin playing as soon as the first chunk is ready, while synthesis of later chunks continues in parallel.

The module exports a single function and maintains a module-level singleton for the TTS model to avoid re-initialization overhead on repeated calls.

## Interface / Exports

### `runStreamingTTS(text: string): Promise<Subprocess>`

```typescript
export async function runStreamingTTS(text: string): Promise<Subprocess>
```

**Parameters:**
- `text` (string): The complete text to synthesize. The function splits it into words and feeds them to the TTS engine word-by-word with a small artificial delay to simulate streaming token generation.

**Returns:**
- `Promise<Subprocess>`: Resolves to the `ffplay` subprocess handle immediately after text feeding begins (but before playback is complete). The caller can use this handle to kill playback early (e.g., for barge-in interruption).

**Behavior:** The function is `async` but returns the subprocess handle before synthesis and playback are complete. The audio stream continues in the background via a fire-and-forget async IIFE.

## Configuration

### Model Configuration (hardcoded)

```typescript
KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
  dtype: "q8",    // 8-bit quantized weights
  device: "cpu",  // CPU inference (no GPU required)
})
```

- **Model**: `onnx-community/Kokoro-82M-v1.0-ONNX` — the 82M parameter Kokoro TTS model in ONNX format, downloaded from Hugging Face Hub on first call.
- **dtype**: `q8` — 8-bit quantization, reducing memory usage and improving CPU inference speed at a small quality cost.
- **device**: `cpu` — explicitly CPU inference. No CUDA or Metal GPU acceleration is used.

### ffplay Configuration (hardcoded)

```
ffplay -autoexit -nodisp -f f32le -ar 24000 -ch_layout 1 -i -
```

- `-autoexit`: ffplay exits automatically when stdin closes (stream ends).
- `-nodisp`: Suppresses the ffplay window — audio-only playback.
- `-f f32le`: Raw 32-bit float little-endian PCM input format. Kokoro outputs `Float32Array` data.
- `-ar 24000`: 24,000 Hz sample rate — Kokoro's native output rate.
- `-ch_layout 1`: Mono channel layout. Note: using `1` as a shorthand instead of the named layout `"mono"` may produce deprecation warnings in newer FFmpeg versions.
- `-i -`: Read from stdin.

### External Dependencies

- **`kokoro-js`** npm package: Provides `KokoroTTS` and `TextSplitterStream`. Must be installed via `bun install`.
- **`ffplay`**: Part of the FFmpeg suite. Must be installed and on `PATH`. On macOS, `brew install ffmpeg` includes `ffplay`.
- **Hugging Face Hub** (first call only): The ONNX model is downloaded from `onnx-community/Kokoro-82M-v1.0-ONNX` on first initialization. Subsequent calls use the cached model.
- **No environment variables**: No configuration is read from environment.

## Data Flow

```
text (string)
    ↓
[Parallel: ffplay subprocess started with stdin pipe]
    ↓
KokoroTTS singleton initialized (once, lazy, blocks on first call)
    ↓
TextSplitterStream created
ttsInstance.stream(splitter) → async iterable of { text, audio }
    ↓
[Background async IIFE — consumes stream]:
  for each { text: chunkText, audio } chunk:
    extract waveData = audio.audio || audio.data  (Float32Array)
    write Buffer.from(waveData.buffer) → ffplay.stdin
    ↓
  finally: ffplay.stdin.end() → ffplay drains buffer and exits (-autoexit)

[Foreground — text feeding]:
  for each word token in text.split(" "):
    splitter.push(token + " ")
    await sleep(20ms)
    ↓
  splitter.close()
    ↓
return ffplay subprocess handle
```

## Code Paths

### Initialization (lazy singleton)

On the first call to `runStreamingTTS`:
1. `ttsInstance` is `null` → logs "Initializing Kokoro-82M..."
2. Awaits `KokoroTTS.from_pretrained(...)` — downloads and loads the model. This can take several seconds on first run (model download + ONNX session creation).
3. Sets `ttsInstance` to the loaded model. On all subsequent calls this block is skipped entirely.

### Main path — streaming playback

1. **Splitter and stream setup**: `new TextSplitterStream()` creates a push-based text input queue. `ttsInstance.stream(splitter)` returns an async iterable that yields `{ text, audio }` objects as synthesis chunks become available.

2. **ffplay spawn**: A new `ffplay` subprocess is started with `stdin: "pipe"`, `stdout: "ignore"`, `stderr: "ignore"`. Stored in the `ffplay` variable.

3. **Background consumer IIFE** (`void (async () => { ... })()`):
   - Iterates `for await (const { text: chunkText, audio } of stream)`.
   - Logs each chunk's text at DEBUG level.
   - Extracts waveform data: `(audio as any).audio || (audio as any).data`. The `any` cast and dual-field check handle API differences between `transformers.js` versions where the audio output field may be named either `.audio` or `.data`.
   - If `waveData` is truthy and `ffplay.stdin` is open: writes `Buffer.from(waveData.buffer)` to stdin. `waveData` is a `Float32Array`; `.buffer` gives the underlying `ArrayBuffer`; `Buffer.from()` wraps it without copying.
   - On stream error: logged via `logger.error`. The loop exits.
   - `finally`: calls `ffplay.stdin.end()` regardless of success or error. This signals end-of-stream to ffplay, which drains its buffer and exits due to `-autoexit`.

4. **Foreground text feeding**:
   - Splits `text` by `" "` (single space).
   - For each token: pushes `token + " "` to `splitter`, then waits 20ms.
   - After all tokens: calls `splitter.close()` to signal no more text is coming.

5. **Return**: `ffplay` is returned after `splitter.close()`, before the background consumer has finished processing all audio chunks.

### Error path

- **TTS stream error**: Caught in the background IIFE's `try/catch`. Logged. The `finally` block closes `ffplay.stdin`, causing ffplay to exit cleanly (though potentially mid-playback).
- **Model initialization failure**: `await KokoroTTS.from_pretrained(...)` is not wrapped in try/catch. If it throws (e.g., network failure, disk full), the error propagates to the caller of `runStreamingTTS`.
- **`ffplay` not on PATH**: `Bun.spawn` throws; propagates to caller.

## Helper Functions / Internals

### Module-level singleton: `ttsInstance`

```typescript
let ttsInstance: KokoroTTS | null = null;
```

The Kokoro model is stored at module scope. Once initialized, it persists for the lifetime of the process. This is intentional — model loading is expensive (seconds, hundreds of MB), and reusing the same instance avoids re-initialization on each TTS call.

**Implication**: The module is stateful. If the model configuration needs to change (e.g., different quantization or voice), the process must be restarted.

## Error Handling

| Scenario | Handling |
|----------|----------|
| Model initialization fails | Error propagates to caller (no try/catch around `from_pretrained`) |
| TTS stream error mid-playback | Caught, logged, ffplay stdin closed, playback ends at the last written chunk |
| `ffplay` not on PATH | `Bun.spawn` throws; propagates to caller |
| `waveData` is `undefined`/`null` | `if (waveData && ffplay.stdin)` guard silently skips the write |
| `ffplay.stdin` null or closed early | Same guard prevents write to closed stream |

No error events are emitted. The caller cannot programmatically distinguish successful completion from a mid-stream error without inspecting the `ffplay` process exit code via `await ffplay.exited`.

## Integration Context

`runStreamingTTS` is exported but **not currently imported anywhere** in the codebase. The grep across `src/**/*.ts` found no imports of `stream-tts` or `runStreamingTTS` outside the module itself.

The module is clearly intended to be called by an agent's speech output layer — likely as part of a TTS plugin or a hook in `BaseAgent` that calls `runStreamingTTS(response)` after each LLM response. The returned `ffplay` subprocess handle is designed to support barge-in: when `AudioPlugin` calls `agent.interrupt()`, the caller would also call `ffplay.kill()` to stop playback immediately. This integration has not yet been wired up.

## Observations / Notes

- **Artificial 20ms word delay**: The `await new Promise((r) => setTimeout(r, 20))` between word pushes is described as simulating "thinking" or slow token generation. In a real integration where text comes from an LLM streaming output, this delay would be replaced by the actual token arrival rate from the LLM. The current implementation simulates streaming from a pre-complete string.
- **`text.split(" ")` is fragile**: Splits on single spaces only. Multiple consecutive spaces produce empty-string tokens, which push a bare `" "` to the splitter. Punctuation is not treated specially. For typical LLM output this is acceptable but could produce minor artifacts.
- **`(audio as any).audio || (audio as any).data`**: The dual-field check with `any` casts is a runtime API compatibility shim for different versions of the underlying `transformers.js` dependency. If neither field is present, `waveData` is `undefined` and the chunk is silently dropped. This is fragile against future `kokoro-js` API changes.
- **Return before playback completion**: The caller receives the `ffplay` subprocess before synthesis and playback are complete. To know when playback finishes, the caller must await `ffplay.exited`. To interrupt playback, the caller calls `ffplay.kill()`.
- **No voice selection**: The Kokoro model supports multiple voices, but no voice parameter is exposed by `runStreamingTTS`. The Kokoro default voice is used unconditionally. Adding an optional `voice` parameter would require threading it through to the `ttsInstance.stream()` call.
- **`ffplay -ch_layout 1`**: Using `1` as the channel layout argument (instead of the named string `"mono"`) may produce a deprecation warning in newer FFmpeg versions. Functionally equivalent for current versions.
- **Module-level singleton and concurrency**: If `runStreamingTTS` is called concurrently (e.g., two agent responses overlap), two separate `ffplay` instances will both try to play audio through the same output device simultaneously. There is no queuing, exclusion, or playback state tracking.
- **`ffplay` stdout/stderr are ignored**: Any playback errors (device not found, unsupported format) are silently discarded. Removing `stdout: "ignore", stderr: "ignore"` during debugging would surface ffplay diagnostics.
- **Memory**: Each audio chunk is a `Float32Array` held in memory until written to ffplay's stdin pipe. Kokoro produces chunks sentence-by-sentence, so memory pressure is bounded to roughly one sentence of audio at a time.
