# AudioProvider Assessment

## Module Overview

`AudioProvider` is a low-level hardware abstraction that captures raw audio from a macOS microphone using FFmpeg's `avfoundation` input driver. It spawns an `ffmpeg` subprocess, configures it to produce 16kHz mono 16-bit little-endian PCM (the exact format required by Whisper-compatible speech recognition), and streams the raw binary output chunk-by-chunk as Node `Buffer` objects via an EventEmitter event.

Its role is purely capture and streaming — it does not interpret, buffer beyond chunk boundaries, or filter audio. It is the first stage in the audio pipeline: microphone hardware → `AudioProvider` → `VoiceActivityDetector`.

## Interface / Exports

```typescript
export class AudioProvider extends EventEmitter
```

### Constructor

```typescript
constructor(deviceId: string = ":0")
```

- `deviceId`: An `avfoundation` device specifier. On macOS, audio-only devices use the format `:<index>` (e.g., `:0` for the first audio device, `:1` for the second). The default `:0` targets the default microphone.

### Public Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `start(): void` | Validates the device ID, spawns the `ffmpeg` process, and begins monitoring its stdout. Idempotent — does nothing if already started. |
| `stop` | `stop(): void` | Kills the `ffmpeg` process and nulls the reference. Logs the stop event. |

### Events Emitted

| Event | Payload | Description |
|-------|---------|-------------|
| `audio_chunk` | `Buffer` | A raw PCM chunk read from ffmpeg's stdout. Emitted on each chunk as it arrives from the OS. |

## Configuration

### Constructor Options

- `deviceId` (string, default `":0"`): The `avfoundation` device index string for the microphone. Passed directly to `ffmpeg -i`. The format `:N` selects audio device N.

### External Dependencies

- **`ffmpeg`** must be installed and available on `PATH`. The binary is invoked directly by `Bun.spawn`. No environment variable controls the path.
- **macOS only**: Uses `-f avfoundation`, which is an Apple-platform-specific FFmpeg input driver. This module will not work on Linux or Windows without significant modification.

### FFmpeg Arguments Used

```
ffmpeg -loglevel quiet -f avfoundation -i <deviceId>
       -ac 1 -ar 16000 -f s16le -c:a pcm_s16le pipe:1
```

- `-loglevel quiet`: Suppresses all ffmpeg console output.
- `-ac 1`: Mono audio (1 channel).
- `-ar 16000`: 16,000 Hz sample rate — required by Whisper.
- `-f s16le -c:a pcm_s16le`: Signed 16-bit little-endian PCM output format with matching codec.
- `pipe:1`: Writes to stdout, which Bun captures.
- `stderr: "ignore"`: FFmpeg's stderr is discarded entirely.

## Data Flow

```
Microphone hardware
    ↓ (OS audio driver)
avfoundation input driver (inside ffmpeg)
    ↓ (transcode/resample)
s16le PCM @ 16kHz mono (stdout of ffmpeg process)
    ↓ (Bun AsyncIterator over stdout)
monitorStream() — reads Uint8Array chunks
    ↓ (Buffer.from(chunk) conversion)
"audio_chunk" event → downstream consumers
```

## Code Paths

### `start()`

1. Guard: returns immediately if `this.process` is already set (prevents double-start).
2. Calls `validateDeviceId(this.deviceId)` — throws if the device ID contains unsafe characters.
3. Logs the start event via `logger.info`.
4. Calls `Bun.spawn(...)` with the ffmpeg command array, setting `stderr: "ignore"`. The spawned process is stored in `this.process`.
5. Calls `this.monitorStream()` (fire-and-forget; not awaited).

### `stop()`

1. Guard: does nothing if `this.process` is null.
2. Calls `this.process.kill()` to send SIGTERM to the ffmpeg process.
3. Nulls `this.process`.
4. Logs the stop event.

### `monitorStream()` (private, async)

1. Iterates over `this.process.stdout` using `for await...of` — Bun's subprocess stdout is an async iterable of `Uint8Array`.
2. Each `Uint8Array` chunk is converted to a Node `Buffer` via `Buffer.from(chunk)`.
3. The buffer is emitted as `"audio_chunk"`.
4. The loop ends naturally when the ffmpeg process exits (stdout closes).

### `validateDeviceId()` (private)

1. Tests the device ID string against the regex `/^[a-zA-Z0-9 \-:._]+$/`.
2. Throws `Error` with a descriptive message if the ID contains any character outside the allowed set. This prevents shell injection through unusual device IDs.

## Helper Functions / Internals

### `validateDeviceId(id: string): void`

A basic allowlist regex check. Permitted characters: alphanumerics, space, hyphen, colon, period, underscore. The colon is essential because audio device IDs in avfoundation use the `:N` format. This is a sanity check — not a full security boundary, since the device ID is passed as an array element to `spawn` (not through a shell), so injection risk is already low.

## Error Handling

- **Invalid device ID**: `validateDeviceId` throws synchronously before `spawn` is called. The error propagates to the caller of `start()`.
- **ffmpeg process failure**: If ffmpeg exits with an error (e.g., device not found, permission denied), its stderr is silently discarded (`stderr: "ignore"`). The `monitorStream` loop will simply end because stdout closes. No error event is emitted — the `AudioProvider` will silently stop producing `audio_chunk` events. There is no reconnect logic.
- **No error event emitted**: `AudioProvider` never emits an `"error"` event. Downstream consumers cannot distinguish between normal stop and ffmpeg failure.

## Integration Context

`AudioProvider` is consumed exclusively by `AudioSystem` via its constructor:

```typescript
// AudioSystem.ts
this.mic.on("audio_chunk", (chunk: Buffer) => {
  this.vad.processChunk(chunk);
});
```

`AudioSystem` is itself constructed by `MicrophoneInputSource.start()`:

```typescript
new AudioProvider(await selectAudioDevice())
```

`selectAudioDevice()` (from `deviceSelector.ts`) prompts the user interactively to choose a device and returns the `:N` formatted ID that `AudioProvider` expects.

The full pipeline:
```
selectAudioDevice() → AudioProvider → AudioSystem → VoiceActivityDetector → TranscriptionProvider
```

## Observations / Notes

- **macOS-only**: The `avfoundation` input format is Apple-specific. No cross-platform fallback exists.
- **Silent failure on ffmpeg errors**: If the microphone device is unavailable or ffmpeg crashes, the system silently stops receiving audio with no error surfaced to the application. Adding stderr capture and error events would improve observability.
- **No reconnect logic**: If the audio stream drops, the only recovery is calling `stop()` then `start()` externally.
- **`ffmpeg -loglevel quiet` hides all output**: This is intentional for clean operation, but makes debugging hardware issues difficult. A `DEBUG`-level stderr capture option would be useful.
- **Chunk size is OS-determined**: The size of each `audio_chunk` buffer depends on the OS audio buffer and ffmpeg's internal buffering. Downstream code (especially `VoiceActivityDetector`) must handle variable-size chunks.
- **`stderr: "ignore"` vs no stderr option**: Bun's `spawn` default for unspecified stdio is `"inherit"`. Explicitly setting `stderr: "ignore"` is correct to prevent ffmpeg log noise from leaking to the terminal.
- **`process` typed as `any`**: Bun's `spawn` return type is not explicitly annotated on the field, so it is typed `any`. This loses type safety on the process handle.
