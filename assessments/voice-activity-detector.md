# VoiceActivityDetector Assessment

## Module Overview

`VoiceActivityDetector` (VAD) is the speech boundary detection stage in the audio pipeline. It receives a continuous stream of raw 16-bit PCM audio chunks and determines, on a chunk-by-chunk basis, whether the user is speaking or silent. When it detects the end of a spoken utterance (defined as energy above threshold followed by a configurable silence window), it concatenates all accumulated audio chunks and emits the complete utterance as a single buffer for transcription.

The algorithm is energy-based (RMS amplitude), not machine-learning based. It is simple, low-latency, and tunable, but is sensitive to background noise levels.

## Interface / Exports

### `VADConfig` (type)

```typescript
export type VADConfig = {
  energyThreshold?: number;   // RMS amplitude required to trigger "speech". Default: 500.
  silenceDurationMs?: number; // Milliseconds of silence before utterance is finalized. Default: 1500.
};
```

Both fields are optional; the constructor applies defaults for any omitted field.

### `VoiceActivityDetector` (class)

```typescript
export class VoiceActivityDetector extends EventEmitter
```

#### Constructor

```typescript
constructor(config?: VADConfig)
```

Accepts an optional config object. Applies defaults:
- `energyThreshold`: `500`
- `silenceDurationMs`: `1500` (1.5 seconds)

#### Public Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `processChunk` | `processChunk(chunk: Buffer): void` | Feed a raw s16le audio chunk into the VAD. This is the only input method. |

#### Events Emitted

| Event | Payload | Description |
|-------|---------|-------------|
| `speech_started` | (none) | Fired once when the VAD transitions from silence to speech (first chunk above threshold after silence). |
| `utterance_complete` | `Buffer` | Fired when the silence timer fires. Payload is the concatenation of all accumulated chunks (both speech and trailing silence chunks). |

## Configuration

### `energyThreshold` (default: `500`)

The RMS amplitude level that separates "speech" from "silence." The comment in the source notes that 500 "usually work[s] well for a quiet room, but may need tuning."

RMS values for 16-bit PCM range theoretically from 0 to 32,767. At 16kHz mono, typical quiet-room background noise is in the range of 50–200 RMS; conversational speech typically ranges from 1,000–10,000 RMS. The 500 default provides reasonable separation for a quiet environment but would be overwhelmed in a noisy environment.

In `MicrophoneInputSource`, this is exposed as `energyThreshold` on `MicrophoneInputSourceOptions` with a default of `500` and a hardcoded `silenceDurationMs` of `5000` (overriding the VAD's own default of 1500).

### `silenceDurationMs` (default: `1500`)

How long (in milliseconds) the VAD waits after the last above-threshold chunk before declaring the utterance complete. Set too low, and it clips mid-sentence pauses. Set too high, and there is unnecessary latency before transcription begins.

## Data Flow

```
Raw s16le PCM Buffer (from AudioProvider via AudioSystem)
    ↓ processChunk()
calculateEnergy() → RMS float
    ↓
┌────────────────────────────────────────────────────┐
│  energy > threshold?                               │
│  YES → handleSpeech()                              │
│    - Cancel any pending silence timer              │
│    - If not yet recording: set isRecording=true,   │
│      emit "speech_started"                         │
│    - Append chunk to audioBuffer                   │
│  NO  → handleSilence()                             │
│    - If not recording: return early (ignore)       │
│    - Append chunk to audioBuffer (preserve tail)   │
│    - If no timer running: start silenceDuration    │
│      timer → on fire: completeUtterance()          │
└────────────────────────────────────────────────────┘
    ↓ (on timer fire)
completeUtterance()
    - isRecording = false
    - Concatenate all buffered chunks
    - Clear audioBuffer
    - emit "utterance_complete" with concatenated Buffer
```

## Code Paths

### `processChunk(chunk: Buffer)` — public entry point

1. Calls `calculateEnergy(chunk)` to get the RMS value.
2. Branches: if `energy > this.threshold`, calls `handleSpeech(chunk)`; otherwise calls `handleSilence(chunk)`.

### `handleSpeech(chunk: Buffer)` — private

**Purpose**: Record an above-threshold chunk and manage recording state.

1. If `this.silenceTimer` is set, clears it. This handles the case where the user paused mid-sentence but resumed speaking before the silence window expired.
2. If `this.isRecording` is `false`: sets it to `true` and emits `"speech_started"`.
3. Appends `chunk` to `this.audioBuffer`.

### `handleSilence(chunk: Buffer)` — private

**Purpose**: Accumulate trailing silence and manage the silence timer.

1. **Early return**: If `!this.isRecording`, the VAD is in the background silence state. Background silence is ignored; the chunk is not buffered.
2. If recording: appends `chunk` to `this.audioBuffer`. This deliberately includes silence chunks so that the end of words is not abruptly clipped when the WAV file is assembled.
3. If `this.silenceTimer` is null, starts a `setTimeout` for `this.silenceDuration` ms. The callback calls `completeUtterance()`.

### `completeUtterance()` — private

**Purpose**: Finalize the utterance and emit it.

1. Sets `this.isRecording = false`.
2. Sets `this.silenceTimer = null`.
3. Calls `Buffer.concat(this.audioBuffer)` to merge all chunks.
4. Resets `this.audioBuffer = []` for the next utterance.
5. Emits `"utterance_complete"` with the concatenated buffer.

### `calculateEnergy(buffer: Buffer): number` — private

**Purpose**: Compute the Root Mean Square (RMS) energy of a 16-bit PCM buffer.

1. Iterates over the buffer in 2-byte steps (one 16-bit sample per step).
2. Reads each sample as a signed 16-bit little-endian integer via `buffer.readInt16LE(i)`.
3. Accumulates the squared sample values.
4. Returns `Math.sqrt(sumSquares / sampleCount)`, where `sampleCount = buffer.length / 2`.

This is standard RMS energy, which correlates well with perceived loudness.

## Helper Functions / Internals

### `calculateEnergy(buffer: Buffer): number` (private)

The core math. Returns an RMS value in the range [0, 32,767] for valid 16-bit signed PCM. Called once per chunk. For a 16kHz stream with typical OS chunk sizes of ~4096 bytes (2048 samples, ~128ms of audio), this function iterates 2048 times per call — computationally negligible.

**Edge case — empty buffer**: If `buffer.length === 0`, `sampleCount` is `0`, `sumSquares` is `0`, and the function returns `NaN` (`Math.sqrt(0/0)`). `NaN > threshold` evaluates to `false`, so an empty chunk is treated as silence. This is safe behavior but not explicitly documented.

**Edge case — odd-length buffer**: If `buffer.length` is odd, the last byte is skipped (the loop steps by 2). The `sampleCount` is computed as `buffer.length / 2` (a non-integer), which produces a fractionally wrong denominator but does not throw.

## Error Handling

`VoiceActivityDetector` contains no try/catch blocks and never emits an `"error"` event. All operations are synchronous and in-memory; the only external side effect is `setTimeout`. Specific failure modes:

- **`readInt16LE` out-of-bounds**: The loop condition `i < buffer.length` with a step of 2 means the last possible value of `i` is `buffer.length - 2` (even-length buffer) or `buffer.length - 3` (odd-length), so `readInt16LE(i)` always reads at a valid offset. No out-of-bounds risk.
- **`completeUtterance` called twice**: Not possible — the timer reference is nulled before the callback fires, and the callback itself also nulls it.

## Integration Context

`VoiceActivityDetector` is instantiated in one place:

```typescript
// MicrophoneInputSource.ts
new VoiceActivityDetector({
  energyThreshold: this.options.energyThreshold ?? 500,
  silenceDurationMs: 5000,
})
```

Note that `MicrophoneInputSource` hardcodes `silenceDurationMs: 5000` (5 seconds), overriding the VAD's own 1500ms default. This is a significantly longer silence window — likely to accommodate natural pauses in longer commands.

`AudioSystem` wires the VAD in its constructor:

```typescript
// AudioSystem.ts
this.mic.on("audio_chunk", (chunk: Buffer) => {
  this.vad.processChunk(chunk);
});
this.vad.on("speech_started", () => { this.emit("status_change", "listening"); });
this.vad.on("utterance_complete", async (buffer: Buffer) => { /* transcribe */ });
```

The VAD is the middle stage of the three-stage pipeline:
```
AudioProvider → VoiceActivityDetector → TranscriptionProvider
```

## Observations / Notes

- **Energy-based VAD is noise-sensitive**: The `energyThreshold` of 500 assumes a quiet environment. In a noisy environment (fans, TV, street noise), background noise RMS may exceed 500, causing the VAD to never exit recording state or to continuously trigger utterances. A higher threshold or an adaptive threshold would be needed for robust real-world use.
- **Silence chunks are buffered**: `handleSilence` appends below-threshold chunks to `audioBuffer` while recording. This is correct — it preserves trailing consonants and natural word endings. However, with a 5-second silence window (as used in `MicrophoneInputSource`), up to 5 seconds of silence audio is included at the end of every buffer sent to Whisper. This increases both network payload and Whisper processing time.
- **No maximum utterance length**: There is no cap on how long the VAD will record. If the user speaks continuously or background noise keeps energy above threshold, `audioBuffer` grows indefinitely. A maximum duration with forced utterance completion would add robustness.
- **No reset/clear API**: There is no public method to discard a recording-in-progress. If `AudioSystem.stop()` is called mid-utterance, the pending silence timer will still fire and emit `utterance_complete` with whatever audio was buffered.
- **Timer type**: `silenceTimer` is typed as `Timer | null`. This is the Bun-specific `Timer` type returned by `setTimeout`. Node.js would type this as `NodeJS.Timeout`. This is correct for the Bun runtime.
- **`speech_started` fires only once per utterance**: The `if (!this.isRecording)` guard ensures the event fires exactly once when transitioning from silence to speech. It will not fire again until the utterance completes and `isRecording` resets to `false`.
- **No inter-chunk smoothing**: The VAD makes each chunk decision independently. There is no hysteresis, hold-time, or smoothing on the energy threshold. A single loud noise triggers recording; a single brief dip below threshold starts the silence timer. A minimum speech duration or multi-chunk confirmation would reduce false positives.
