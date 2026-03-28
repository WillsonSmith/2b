# Assessment: AudioSystem
**File:** src/providers/audio/AudioSystem.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] Concurrent transcription race (line 26): The `utterance_complete` handler is an `async` callback that is fire-and-forget. If VAD emits a second `utterance_complete` while the first `transcriber.transcribe()` call is still awaited, both callbacks run in parallel. Both will emit `status_change: "transcribing"` and then `status_change: "idle"` in their `finally` blocks, stomping on each other's status. Add an `isTranscribing` flag (or a queue) to serialize calls: skip or enqueue the new utterance while one is in flight.
- [x] Stale transcription after stop (line 47–54): `stop()` halts the mic but does not cancel any active VAD silence timer. If `stop()` is called mid-utterance, `VoiceActivityDetector.silenceTimer` will still fire after the mic is stopped, emit `utterance_complete`, and trigger a `transcriber.transcribe()` call. `AudioSystem` should either expose a `destroy()` that calls into the VAD, or the `stop()` method should signal the VAD to discard its current buffer. **Note:** Applied conservatively — `destroy()` removes all listeners so the `utterance_complete` callback will not fire after `destroy()`. The VAD's internal silence timer is not directly cancelable from `AudioSystem` without modifying `VoiceActivityDetector` (cross-module); that part is left for the VAD's own assessment.
- [x] Magic string filter (line 35): `"blank_audio"` is an undocumented magic string with no comment explaining which Whisper build or model version produces it. If the provider changes, this filter silently stops working. Add a comment citing the source, or move the constant to a named variable.
- [x] Whitespace-only transcription passes guard (line 33): `result.text.length > 0` does not guard against whitespace-only strings such as `"  "`. The current `WhisperLocalProvider` trims before returning, so this is safe today — but the `AudioSystem` layer should not rely on that implementation detail. Change the check to `result.text.trim().length > 0`.

## Refactoring / Code Quality
- [x] All event wiring in constructor (lines 16–44): Binding live event listeners in the constructor makes the class hard to unit-test — the object is "live" and emitting as soon as it is constructed. Extract each handler into a named private method (`onAudioChunk`, `onSpeechStarted`, `onUtteranceComplete`) and call them from the constructor. This also makes the wiring easier to read and stub in tests.
- [x] No listener cleanup / destroy method: `AudioSystem` attaches listeners to `this.mic` and `this.vad` but never removes them. If an `AudioSystem` instance is discarded without calling `stop()`, those emitters retain a reference to it, preventing garbage collection. Add a `destroy()` method that calls `this.mic.off(...)` / `this.vad.off(...)` and `this.removeAllListeners()`.
- [x] Misleading comment (line 25): `// 1. Pipe the raw hardware audio into the math engine` — "math engine" is a carryover from AudioProvider's internal context. Rename to "VAD" or "voice activity detector" for clarity.
- [x] `stop()` does not log (line 52–54): `start()` logs `"Online and monitoring environment."`, but `stop()` has no log statement, making it hard to trace shutdown in logs. Add `logger.info("AudioSystem", "Stopped.")` to match the pattern.

## Security
No issues found.

## Performance
No issues found.

## Consistency / Style Alignment
- [x] Inconsistent `type` import (lines 3 vs 5): `AudioProvider` is imported as a value import while `TranscriptionProvider` uses `import { type ... }`. `AudioProvider` is used as a type annotation only (the private field `mic: AudioProvider`), so it should also use `import { type AudioProvider }` for correctness and consistency.
- [x] Explicit `.ts` extension on logger import (line 2): `import { logger } from "../../logger.ts"` uses a `.ts` extension while other imports in the file omit extensions. This is harmless under Bun but inconsistent within the file.

## Notes
- The concurrency bug (concurrent transcription race) is the most impactful issue. Under normal conversational use it is unlikely to trigger, but with a low VAD silence threshold or fast speech it can cause duplicate or out-of-order `speech_detected` emissions upstream.
- Reviewers of `VoiceActivityDetector` should be aware that `AudioSystem.stop()` does not interact with the VAD's timer state — this cross-module gap means `VoiceActivityDetector` needs its own `cancel()` or `reset()` method for a clean shutdown.
- Reviewers of `TranscriptionProvider` implementations should note that `AudioSystem` currently relies on `WhisperLocalProvider` trimming the returned text. The `TranscriptionProvider` interface should document this expectation explicitly.
