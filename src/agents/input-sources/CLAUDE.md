# Input Sources

Concrete implementations of `InputSource` (`src/core/InputSource.ts`). Each emits `direct_input` and/or `ambient_input` events consumed by `BaseAgent`.

## Files

| File | Purpose |
|------|---------|
| `CLIInputSource.ts` | Reads from stdin (or any readable stream); all input is `direct_input` |
| `MicrophoneInputSource.ts` | Full audio pipeline: mic → VAD → Whisper → classified input events |

## CLIInputSource

Simple stdin reader. Every non-empty trimmed line emits `direct_input`. Accepts any `ReadableStream` in the constructor (defaults to `process.stdin`) — useful for testing.

```typescript
agent.addInputSource(new CLIInputSource());
// or: new CLIInputSource(someOtherStream)
```

## MicrophoneInputSource

Assembles the full audio stack on `start()`:

```
selectAudioDevice() → AudioProvider → VoiceActivityDetector → WhisperLocalProvider → AudioSystem
```

**Speech classification:**

| Speech type | Emits |
|---|---|
| Whisper ambient marker (`[BLANK_AUDIO]`, `(music)`, etc.) | `ambient_input` (or dropped if `ignoreAmbient: true`) |
| High `noSpeechProb` (> threshold, default 0.7) | dropped silently |
| Normal speech | `direct_input` |

**Options (`MicrophoneInputSourceOptions`):**

| Option | Default | Description |
|---|---|---|
| `energyThreshold` | `500` | RMS threshold passed to `VoiceActivityDetector` |
| `noSpeechThreshold` | `0.7` | Whisper `noSpeechProb` above which audio is discarded |
| `ignoreAmbient` | `false` | If true, ambient sound markers are silently dropped |

**Note:** `MicrophoneInputSource` hardcodes `silenceDurationMs: 5000` — this is longer than the `VoiceActivityDetector` default (1500ms) to avoid cutting off longer sentences.

For intent classification (directed vs. overheard speech), use `AudioPlugin` instead of `MicrophoneInputSource`.

## Choosing Between Them

- Text/terminal interface → `CLIInputSource`
- Voice interface (simple — all speech goes to agent) → `MicrophoneInputSource`
- Voice interface with ambient/overheard classification → `MicrophoneInputSource` + `AudioPlugin`
