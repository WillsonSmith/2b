# TranscriptionProvider Assessment

## Module Overview

This module defines the **speech-to-text abstraction layer** for the audio pipeline. It exports:

1. A `TranscriptionResult` data type representing the output of a transcription operation.
2. A `TranscriptionProvider` interface — the contract that any transcription backend must satisfy.
3. `WhisperLocalProvider` — the concrete implementation that sends audio to a locally-running `whisper.cpp` HTTP server.

The key design concern it addresses is the raw PCM-to-WAV conversion: `AudioProvider` produces raw PCM bytes (no file header), but Whisper's HTTP API expects a complete `.wav` file. `WhisperLocalProvider` bridges this gap by prepending a hand-crafted 44-byte WAV header before POSTing to the local server.

## Interface / Exports

### `TranscriptionResult` (interface)

```typescript
export interface TranscriptionResult {
  text: string;           // Transcribed text, trimmed. Empty string if no speech.
  noSpeechProb: number;   // Average no-speech probability across all Whisper segments (0–1).
}
```

`noSpeechProb` is averaged across all segments in the Whisper response. A high value (approaching 1.0) indicates Whisper is confident there was no intelligible speech.

### `TranscriptionProvider` (interface)

```typescript
export interface TranscriptionProvider {
  transcribe(audioBuffer: Buffer): Promise<TranscriptionResult>;
}
```

A minimal single-method contract. Any class implementing this interface can be used as the transcription backend in `AudioSystem`. Currently only `WhisperLocalProvider` implements it.

### `WhisperLocalProvider` (class)

```typescript
export class WhisperLocalProvider implements TranscriptionProvider
```

#### Constructor

```typescript
constructor(endpoint: string = "http://localhost:8080/inference")
```

- `endpoint`: The full URL of the local Whisper inference server. Defaults to the standard `whisper.cpp` server address and path.

#### Public Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `transcribe` | `transcribe(audioBuffer: Buffer): Promise<TranscriptionResult>` | Converts raw PCM to WAV, POSTs to the Whisper server, and returns the parsed result. |

## Configuration

### Constructor Options

- `endpoint` (string, default `"http://localhost:8080/inference"`): The whisper.cpp or compatible inference server URL. The comment notes `http://localhost:8000/v1/audio/transcriptions` as an alternative for other engines (e.g., faster-whisper or OpenAI-compatible servers).

### External Dependencies

- **whisper.cpp HTTP server** (or compatible): Must be running at the configured endpoint. No authentication is used.
- **No environment variables**: The endpoint is passed explicitly at construction time by the caller.

### Expected Whisper API Contract

The provider sends a `multipart/form-data` POST with:
- `file`: A `.wav` binary blob with `type: "audio/wav"` and filename `"speech.wav"`.
- `response_format`: `"verbose_json"`.

It expects the response JSON to contain:
```typescript
{
  text?: string;
  segments?: Array<{ no_speech_prob?: number }>;
}
```

This matches the `whisper.cpp` server's `verbose_json` output format. It also matches the OpenAI Audio Transcriptions API format (with `verbose_json`), making the provider broadly compatible.

## Data Flow

```
Raw s16le PCM Buffer (from VoiceActivityDetector via AudioSystem)
    ↓
Guard: return early if buffer.length === 0
    ↓
createWavHeader(buffer.length) → 44-byte Buffer
    ↓
Buffer.concat([wavHeader, audioBuffer]) → complete WAV file in memory
    ↓
new Blob([wavFileBuffer], { type: "audio/wav" })
    ↓
FormData with "file" (blob, "speech.wav") + "response_format" ("verbose_json")
    ↓
fetch(endpoint, { method: "POST", body: formData })
    ↓
response.json() → { text?, segments?: [{ no_speech_prob? }] }
    ↓
text = data.text?.trim() ?? ""
noSpeechProb = average of segment.no_speech_prob values (or 0 if no segments)
    ↓
return { text, noSpeechProb }
```

## Code Paths

### `transcribe(audioBuffer: Buffer)`

**Early return path — empty buffer:**
If `audioBuffer.length === 0`, immediately returns `{ text: "", noSpeechProb: 1.0 }`. This handles the edge case where VAD completes an utterance with no accumulated audio.

**Main path — non-empty buffer:**

1. **WAV construction**: Calls `createWavHeader(audioBuffer.length)` to produce a 44-byte header, then `Buffer.concat([wavHeader, audioBuffer])` to produce a complete in-memory WAV file.

2. **Multipart form assembly**: Creates a `FormData` with a `Blob` containing the WAV data (typed `audio/wav`, named `speech.wav`) and a `response_format` field set to `"verbose_json"`.

3. **HTTP POST**: `fetch(this.endpoint, { method: "POST", body: formData })`. No timeout is set.

4. **Response validation**: If `!response.ok`, throws `Error` with the HTTP status code.

5. **JSON parsing**: Casts the response body to `{ text?: string; segments?: Array<{ no_speech_prob?: number }> }`.

6. **Text extraction**: `data.text?.trim() ?? ""`.

7. **noSpeechProb calculation**:
   - If `data.segments` is a non-empty array: sums all `segment.no_speech_prob ?? 0` values and divides by segment count.
   - Otherwise: defaults to `0`.

8. **Returns** `{ text, noSpeechProb }`.

**Error path:**
Any exception (network failure, bad JSON, HTTP error) is caught, logged via `logger.error`, and a fallback `{ text: "", noSpeechProb: 1.0 }` is returned. Errors are never re-thrown.

### `createWavHeader(dataLength: number): Buffer` (private)

Produces a standard 44-byte WAV/RIFF header hardcoded for:
- 1 channel (mono)
- 16,000 Hz sample rate
- 16-bit PCM (2 bytes/sample)
- `dataLength` bytes of audio data

The header layout:

| Offset | Size | Field | Value |
|--------|------|-------|-------|
| 0 | 4 | ChunkID | "RIFF" |
| 4 | 4 | ChunkSize | `36 + dataLength` |
| 8 | 4 | Format | "WAVE" |
| 12 | 4 | Subchunk1ID | "fmt " |
| 16 | 4 | Subchunk1Size | 16 |
| 20 | 2 | AudioFormat | 1 (PCM) |
| 22 | 2 | NumChannels | 1 |
| 24 | 4 | SampleRate | 16000 |
| 28 | 4 | ByteRate | 32000 (16000 × 2) |
| 32 | 2 | BlockAlign | 2 |
| 34 | 2 | BitsPerSample | 16 |
| 36 | 4 | Subchunk2ID | "data" |
| 40 | 4 | Subchunk2Size | `dataLength` |

All multi-byte integers are written little-endian (LE), as required by the WAV spec for PCM format. The ASCII strings are written with Node `Buffer.write()` which defaults to UTF-8 (correct for ASCII field values).

## Helper Functions / Internals

### `createWavHeader(dataLength: number): Buffer` (private)

The only internal helper. Creates a complete WAV header for 16kHz/16-bit/mono PCM. The parameters are hardcoded to match the specific format that `AudioProvider` produces — they are not configurable. This creates an implicit coupling: if `AudioProvider`'s ffmpeg arguments change (e.g., sample rate or bit depth), `createWavHeader` must be updated in sync.

## Error Handling

- **Empty buffer**: Returns `{ text: "", noSpeechProb: 1.0 }` immediately. Conservative — treats no audio as definitely-not-speech.
- **HTTP non-200**: Throws `Error` internally, caught by the outer try/catch.
- **Network failure**: Caught by try/catch, logged, returns `{ text: "", noSpeechProb: 1.0 }`.
- **JSON parse failure**: Caught by try/catch, logged, returns fallback.
- **No segments in response**: `noSpeechProb` defaults to `0` (treated as "definitely speech"). This is the opposite of the error/empty-buffer fallback and could let noise through if a server returns text but no segments.
- **Errors are never re-thrown**: `AudioSystem`'s error handler logs them, and upstream code always receives a valid `TranscriptionResult` object.

## Integration Context

`WhisperLocalProvider` is instantiated in one place:

```typescript
// MicrophoneInputSource.ts
new WhisperLocalProvider()  // uses default endpoint
```

It is passed to `AudioSystem` as the `transcriber` argument. `AudioSystem` calls `transcriber.transcribe(buffer)` in its `utterance_complete` handler.

The `TranscriptionProvider` interface is imported as a type in `AudioSystem.ts`, enabling future substitution of the whisper backend without changing `AudioSystem`.

## Observations / Notes

- **No fetch timeout**: The `fetch` call has no `AbortController` or timeout. If the whisper.cpp server is unresponsive, `transcribe()` will hang indefinitely, blocking the `utterance_complete` handler in `AudioSystem`. A 5–10 second timeout would improve resilience.
- **WAV header is hardcoded to 16kHz/16-bit/mono**: These values are correct as long as `AudioProvider` continues producing s16le PCM at 16kHz. There is no runtime validation that the incoming buffer actually matches these parameters.
- **`noSpeechProb` defaults to `0` when no segments**: This is the least conservative default — `0` means "definitely speech." If the server returns text but omits the segments array, this will pass the confidence filter in downstream consumers.
- **`no_speech_prob` averaging**: The average across segments is a reasonable heuristic, but individual segments with very high `no_speech_prob` could be diluted by low-probability segments. A max instead of average might be more conservative for noisy environments.
- **`"blank_audio"` not filtered here**: The blank_audio token filtering happens in `AudioSystem`, not in the provider. This is correct separation of concerns — the provider returns exactly what Whisper said.
- **Interface enables testability**: The `TranscriptionProvider` interface allows `AudioSystem` to be tested with a mock transcriber without a running whisper server.
- **Bun Blob is used correctly**: `FormData` with a `Blob` is a standard Web API and Bun implements it faithfully. The comment noting "Bun's native Blob handles the binary translation perfectly" is accurate.
