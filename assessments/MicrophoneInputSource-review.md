# Assessment: MicrophoneInputSource.ts
**File:** src/agents/input-sources/MicrophoneInputSource.ts
**Reviewed:** 2026-03-26
**Risk level:** Medium

## Bug Fixes
- [ ] `stop()` does not remove the `speech_detected` listener (lines 42–47, 53–55): `this.audioSystem?.stop()` stops audio capture but does not call `this.audioSystem.off("speech_detected", ...)`. If the underlying `AudioSystem` delivers a buffered event after `stop()` is called, `handleSpeech` will still fire and emit a `direct_input` event into a stopped input source. Store the handler reference and explicitly remove it in `stop()`.
- [ ] `start()` creates a new `AudioSystem` on every call without tearing down any previous instance (line 33): If `start()` is called twice (e.g. after a reconnect), `this.audioSystem` is overwritten with a new instance but the old one is never stopped or dereferenced, leaking the previous audio device handle and event listeners.
- [ ] `this.audioSystem.start()` is called without `await` and without error handling (line 49): If `AudioSystem.start()` returns a Promise (or throws synchronously), errors are silently swallowed. Await the call and add a try/catch, or at minimum attach a `.catch()` handler and surface the error via `logger.error`.
- [ ] `selectAudioDevice()` failure is not caught (line 34): If `selectAudioDevice()` rejects (e.g. no microphone found), the rejection propagates out of `start()` but the `audioSystem` field is never set. The caller may not handle this rejection, leaving the agent silently without a microphone input source. Wrap the entire `start()` body in a try/catch and emit an `error` event or rethrow with a descriptive message.

## Refactoring / Code Quality
- [ ] `handleSpeech` ambient marker detection is fragile (lines 61–63): The check `text.startsWith("[") && text.endsWith("]")` will also match legitimate transcriptions that happen to be formatted like `[proper noun]` or single-word responses wrapped in brackets. Whisper's ambient markers are a known finite set; consider matching against a specific list (e.g. `[BLANK_AUDIO]`, `[MUSIC]`, `(Music)`) rather than purely by bracket characters.
- [ ] `noSpeechThreshold` default is applied at call time, not at construction (line 72): The `?? 0.7` default is evaluated inside `handleSpeech` on every invocation. Resolving and storing the effective threshold once in the constructor (or in `start()`) is cleaner and avoids repeated null-coalescing.
- [ ] `silenceDurationMs` is hardcoded to `5000` (line 37): This value is not exposed through `MicrophoneInputSourceOptions` and cannot be tuned by callers. If the silence duration needs to differ between use cases it requires a code change. Expose it as an optional option with `5000` as the default.
- [ ] `audioSystem` field typed as `AudioSystem | undefined` but accessed without null check in `stop()` (line 54): The optional chaining `this.audioSystem?.stop()` is correct, but there is no log or warning when `stop()` is called on an unstarted source. A debug-level log would aid diagnostics.

## Security
- [ ] Transcribed text is logged verbatim at INFO level (line 78): `logger.info("Microphone", \`Heard: ${text}\`)` writes all recognised speech to the log. Depending on the log destination (file, remote sink), this could record sensitive spoken content such as passwords, financial details, or personal conversations. Consider logging only in DEBUG mode, or truncating/redacting the content.

## Performance
- [ ] `WhisperLocalProvider` is instantiated on every `start()` call (line 39): Model loading is typically expensive (hundreds of milliseconds to seconds). If the provider loads the Whisper model in its constructor or `start()`, tearing down and recreating it on every `MicrophoneInputSource.start()` call is wasteful. Consider accepting an externally created provider via the constructor so the model is loaded once.
- [ ] No debouncing or rate-limiting on `speech_detected` events: If `AudioSystem` emits events in rapid succession (e.g. during noisy conditions), every event becomes a `direct_input` emission and a downstream LLM call. A short cooldown or minimum inter-event interval would reduce noise-driven API calls.

## Consistency / Style Alignment
- [ ] `name = "Microphone"` is not `readonly` (line 25): Same pattern as `CLIInputSource`; mark as `readonly` for consistency and to prevent accidental mutation.
- [ ] Options interface comment uses inconsistent JSDoc style (lines 11–13): `energyThreshold` has no JSDoc comment while `noSpeechThreshold` and `ignoreAmbient` do. Add a `/** ... */` comment for `energyThreshold` to complete the documentation.
- [ ] The class-level JSDoc (lines 17–23) says "use AudioPlugin instead" for intent classification, but `AudioPlugin` is not imported or referenced anywhere in the file. Ensure the referenced class name is correct and update the comment if `AudioPlugin` has been renamed or moved.

## Notes
- Risk is Medium primarily due to the listener/resource leak bugs and the absence of error handling on `start()`. In production use these bugs may cause the agent to silently lose its microphone input after any restart or error recovery cycle.
- `WhisperLocalProvider` is hardcoded (line 39) rather than injected. This makes the class impossible to unit-test with a mock transcription provider and tightly couples the input source to a specific transcription implementation. Consider accepting a `TranscriptionProvider` via the constructor, consistent with how `AudioSystem` accepts its dependencies.
- The `ignoreAmbient` option (line 14) defaults to `false`, meaning ambient markers are emitted by default. Callers that do not handle the `ambient_input` event will silently drop these events, which is harmless, but the default arguably creates noise. Verify that `BaseAgent` handles `ambient_input` correctly when `ignoreAmbient` is `false`.
