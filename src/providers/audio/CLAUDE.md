# Audio Providers

Hardware audio capture → voice detection → transcription pipeline. All classes are `EventEmitter`-based and composable.

## Files

| File | Purpose |
|------|---------|
| `AudioProvider.ts` | Spawns FFmpeg to capture microphone PCM audio; emits `audio_chunk` |
| `VoiceActivityDetector.ts` | RMS energy-based VAD; emits `speech_started`, `speech_ended`, `utterance_complete` |
| `TranscriptionProvider.ts` | `TranscriptionProvider` interface + `WhisperLocalProvider` implementation |
| `AudioSystem.ts` | Orchestrates the three above into a single `speech_detected` event |

## Data Flow

```
Microphone → AudioProvider → VoiceActivityDetector → AudioSystem → TranscriptionProvider
                                                         ↓
                                                  speech_detected { text, noSpeechProb }
```

## AudioProvider

Spawns `ffmpeg -f avfoundation` and pipes 16kHz / 16-bit / mono PCM to stdout.

- Default device ID: `":0"` (macOS default microphone)
- Emits: `audio_chunk` (Buffer)
- Device IDs are validated before spawn — only `[a-zA-Z0-9 \-:._]+` is accepted

Use `src/utils/deviceSelector.ts` to interactively select a device at startup.

## VoiceActivityDetector

Receives raw `s16le` chunks via `processChunk(chunk)` and tracks speech state using RMS energy.

**Config (`VADConfig`):**

| Option | Default | Description |
|---|---|---|
| `energyThreshold` | `500` | RMS value above which audio is classified as speech |
| `silenceDurationMs` | `1500` | Silence duration that triggers utterance completion |
| `maxBufferBytes` | `1_920_000` | Safety cap (~60s at 16kHz 16-bit mono) — forces emit if exceeded |
| `debug` | `false` | Logs state transitions to stderr |

**Events:**
- `speech_started` — first speech chunk after silence
- `speech_ended` — first silence chunk after speech (utterance not yet complete)
- `utterance_complete` — Buffer of all audio since `speech_started`

Call `reset()` to discard an in-progress utterance (e.g. when the input stream ends).

## TranscriptionProvider

```typescript
interface TranscriptionProvider {
  transcribe(audioBuffer: Buffer): Promise<TranscriptionResult>;
}

interface TranscriptionResult {
  text: string;
  noSpeechProb: number;  // 0.0 = confident speech, 1.0 = no speech / failure
  error?: string;
}
```

**WhisperLocalProvider** wraps a whisper.cpp HTTP server:
- Endpoint: `WHISPER_ENDPOINT` env var or `http://localhost:8080/inference`
- Input: raw 16kHz, 16-bit mono PCM Buffer → prepends 44-byte WAV header → multipart form POST
- `noSpeechProb` is averaged from `segments[].no_speech_prob`; defaults to `1.0` if segments are absent
- Returns `{ text: "", noSpeechProb: 1.0 }` on empty buffer; returns `error` field on fetch failure

## AudioSystem

Wires the three components together. Owns the event subscriptions; call `destroy()` to remove all listeners cleanly.

**Events emitted:**
- `status_change` — `"listening"` | `"transcribing"` | `"idle"`
- `speech_detected` — `{ text: string, noSpeechProb: number }`

**Concurrency guard:** Only one transcription runs at a time. If an `utterance_complete` event fires while transcription is in flight, the utterance is dropped.

**Blank audio filtering:** Whisper's `"blank_audio"` token is suppressed — it is never emitted as `speech_detected`.

## Gotchas

- `AudioProvider` only works on macOS (avfoundation). Linux/Windows would need a different input format.
- The VAD defaults (threshold 500, silence 1500ms) work well in a quiet room. If speech is frequently missed or cut early, tune `energyThreshold` and `silenceDurationMs` in the `MicrophoneInputSource` constructor.
- `MicrophoneInputSource` hardcodes `silenceDurationMs: 5000` (overrides the VAD default) to avoid cutting off longer sentences.
- `WhisperLocalProvider` uses `response_format: verbose_json` which is whisper.cpp-specific. OpenAI-compatible endpoints may not support this field.
