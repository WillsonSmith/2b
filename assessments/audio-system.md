# AudioSystem Assessment

## Module Overview

`AudioSystem` is the central coordinator ("facade") for the audio pipeline. It wires together three independently constructed components — `AudioProvider` (hardware capture), `VoiceActivityDetector` (speech boundary detection), and `TranscriptionProvider` (speech-to-text) — and exposes a simplified interface to higher-level consumers.

Its role is event plumbing and state broadcasting: it connects the output of each stage to the input of the next, filters out noise-only transcriptions, and emits normalized status and speech events to the rest of the application. Consumers never need to know about the internal three-stage structure.

## Interface / Exports

```typescript
export class AudioSystem extends EventEmitter
```

### Constructor

```typescript
constructor(
  mic: AudioProvider,
  vad: VoiceActivityDetector,
  transcriber: TranscriptionProvider
)
```

All three dependencies are injected at construction time. The constructor immediately wires all inter-component event subscriptions — no separate `init()` call is required.

### Public Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `start` | `start(): void` | Calls `mic.start()` to begin audio capture. Logs startup. |
| `stop` | `stop(): void` | Calls `mic.stop()` to halt audio capture. |

### Events Emitted

| Event | Payload | Description |
|-------|---------|-------------|
| `status_change` | `"listening" \| "transcribing" \| "idle"` | Tracks the current phase of the audio pipeline for UI or logging purposes. |
| `speech_detected` | `TranscriptionResult` (`{ text: string, noSpeechProb: number }`) | Emitted when Whisper returns intelligible speech. Filtered to exclude empty text and Whisper's `"blank_audio"` marker. |

## Configuration

`AudioSystem` itself has no direct configuration — it delegates entirely to its injected components. Configuration lives in:

- `AudioProvider`: device ID, ffmpeg arguments
- `VoiceActivityDetector`: energy threshold, silence duration
- `TranscriptionProvider` / `WhisperLocalProvider`: endpoint URL

## Data Flow

```
AudioProvider ("audio_chunk" event)
    ↓ raw PCM Buffer
VoiceActivityDetector.processChunk()
    ↓ ("speech_started" event)
AudioSystem emits status_change("listening")
    ↓ ("utterance_complete" event, concatenated Buffer)
AudioSystem emits status_change("transcribing")
    ↓
TranscriptionProvider.transcribe(buffer)
    ↓ TranscriptionResult { text, noSpeechProb }
[filter: empty text, "blank_audio" keyword]
    ↓ (if passes filter)
AudioSystem emits speech_detected(result)
    ↓
AudioSystem emits status_change("idle")
```

## Code Paths

### Constructor — event wiring

The constructor performs all event wiring in sequence:

**Step 1 — mic → vad:**
```typescript
this.mic.on("audio_chunk", (chunk: Buffer) => {
  this.vad.processChunk(chunk);
});
```
Every raw PCM chunk from the microphone is immediately forwarded to the VAD.

**Step 2 — vad "speech_started" → status broadcast:**
```typescript
this.vad.on("speech_started", () => {
  this.emit("status_change", "listening");
});
```
When the VAD detects the start of speech, `AudioSystem` broadcasts the `"listening"` status.

**Step 3 — vad "utterance_complete" → transcription:**
```typescript
this.vad.on("utterance_complete", async (buffer: Buffer) => {
  this.emit("status_change", "transcribing");
  try {
    const result = await this.transcriber.transcribe(buffer);
    if (result.text && result.text.length > 0) {
      if (!result.text.toLowerCase().includes("blank_audio")) {
        this.emit("speech_detected", result);
      }
    }
  } catch (error) {
    logger.error("AudioSystem", "Transcription error:", error);
  } finally {
    this.emit("status_change", "idle");
  }
});
```

When the VAD delivers a complete utterance:
1. Emits `status_change("transcribing")`.
2. Awaits `transcriber.transcribe(buffer)`.
3. If `result.text` is non-empty and does not contain `"blank_audio"` (case-insensitive), emits `speech_detected(result)`.
4. In the `finally` block, always emits `status_change("idle")` regardless of success or error.

### `start()`

Calls `mic.start()` and logs. Does not start the VAD or transcriber directly — they activate lazily when they receive events.

### `stop()`

Calls `mic.stop()`. This closes the ffmpeg process, which stops the flow of `audio_chunk` events, which stops the VAD from receiving data. However, if a transcription is already in-flight at the moment `stop()` is called, it will complete and `speech_detected` may still fire after stop.

## Helper Functions / Internals

None. `AudioSystem` contains no private helper methods — it is pure event routing and filtering logic.

## Error Handling

- **Transcription errors**: Caught in the `try/catch` block around `transcriber.transcribe()`. Logged via `logger.error`. The error is swallowed — no error event is emitted upstream. The `finally` block ensures `status_change("idle")` is always emitted even on failure.
- **VAD errors**: Not caught. If `VoiceActivityDetector` throws synchronously inside an event handler, it will propagate uncaught through the EventEmitter. In practice, VAD does not throw.
- **No `"error"` event**: `AudioSystem` never emits an `"error"` event. Consumers have no programmatic way to detect transcription failures.

## Integration Context

### Consumers

**`MicrophoneInputSource`** (`src/agents/input-sources/MicrophoneInputSource.ts`):
Constructs `AudioSystem` with all three components, subscribes to `speech_detected`, applies further filtering (ambient sound markers, `noSpeechProb` threshold), and emits `direct_input` or `ambient_input` events on the `InputSource` interface.

**`AudioPlugin`** (`src/plugins/AudioPlugin.ts`):
Receives a pre-constructed `AudioSystem` and subscribes to `speech_detected` in `onInit()`. Performs LLM-based intent classification to distinguish directed speech from background conversation, then calls `agent.addPerception()` and optionally `agent.interrupt()`.

### Dependencies

- `AudioProvider` (`./AudioProvider`) — hardware capture
- `VoiceActivityDetector` (`./VoiceActivityDetector`) — utterance segmentation
- `TranscriptionProvider` (interface from `./TranscriptionProvider`) — speech-to-text

### Import Locations

```
src/agents/input-sources/MicrophoneInputSource.ts
src/plugins/AudioPlugin.ts  (type-only import)
```

## Observations / Notes

- **`blank_audio` filter is a string-contains check**: The check `result.text.toLowerCase().includes("blank_audio")` is case-insensitive and substring-based. Whisper typically outputs `"[BLANK_AUDIO]"` — the brackets are preserved in the raw text. Lowercasing and substring matching handles minor formatting variations, but the check is distinct from the bracket-based ambient marker check used in `MicrophoneInputSource` and `AudioPlugin`, which catches `[any text]` and `(any text)` patterns. There is some redundancy between these two layers.
- **Status transitions are not guaranteed to be balanced**: If transcription is already in-flight when `stop()` is called, `status_change("idle")` will still fire after stop, potentially confusing UI components expecting the system to be stopped.
- **No `stop()` forwarded to VAD**: The VAD has no stop method, but if a silence timer is pending when `stop()` is called, it will fire and trigger a `utterance_complete` event after the mic is stopped. This would cause a transcription attempt on stale audio.
- **Dependency injection enables testability**: Because all three components are constructor-injected, each can be mocked independently in tests.
- **`noSpeechProb` is logged but not filtered here**: `AudioSystem` logs the `noSpeechProb` value but does not apply a threshold. The probability-based filtering is left to consumers (`AudioPlugin` uses `> 0.7`, `MicrophoneInputSource` also uses `> 0.7` configurable via `noSpeechThreshold`).
- **Concurrent utterances**: If the VAD fires `utterance_complete` again before the first `transcribe()` call completes, both transcriptions run concurrently. There is no queuing or backpressure mechanism.
