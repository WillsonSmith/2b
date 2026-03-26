# Assessment: `InputSource`

**Files covered:**
- `src/core/InputSource.ts`
- `src/agents/input-sources/CLIInputSource.ts`
- `src/agents/input-sources/MicrophoneInputSource.ts`
- `src/core/BaseAgent.ts` (integration points only)
- `src/core/CortexAgent.ts` (integration points only)
- `src/agents/AgentFactory.ts` (integration points only)

---

## Step 1 — Interface Contract

`InputSource` extends Node's `EventEmitter` and declares three abstract members: `name`, `start()`, and `stop()`. The actual contract — the two events `direct_input` and `ambient_input` — lives only in the JSDoc comment, not in the type system. There is no typed event map (e.g. a generic parameter to `EventEmitter<{direct_input: [string]; ambient_input: [string]}>`), so TypeScript cannot verify that:

- subclasses emit the right event names,
- emitted payloads are strings, or
- callers listen on valid event names.

A typo in either the emitter (`"direct_Input"`) or the consumer (`source.on("directInput", ...)`) would compile cleanly and produce a silent runtime failure. The two concrete implementations happen to be correct today, but the contract is purely by convention.

The `name` field is declared `abstract`, which forces subclasses to supply it, but there is no validation that values are non-empty or unique across sources registered on the same agent.

---

## Step 2 — CLIInputSource: Construction and Lifecycle

`CLIInputSource` has no constructor options; all behaviour is fixed. `start()` calls `process.stdin.setEncoding("utf-8")`, `process.stdin.resume()`, and attaches a `"data"` listener. `stop()` calls `process.stdin.pause()`.

**Duplicate-listener risk.** `process.stdin` is a process-global singleton. If `start()` is called more than once — or if two `CLIInputSource` instances are registered — a second `"data"` listener is added to the same stream, causing every keystroke to emit `direct_input` twice. There is no guard against this (`process.stdin.listenerCount("data")` is not checked, and no listener cleanup is performed in `stop()`).

**stop() is incomplete.** `process.stdin.pause()` merely suspends the stream; the `"data"` listener registered in `start()` is not removed. If the stream is later resumed by any other code, the listener fires again. A correct `stop()` would also call `process.stdin.removeListener("data", handler)`, which requires saving a reference to the handler at `start()` time.

**Global side-effect.** Pausing `process.stdin` is a process-wide action. If any other module reads stdin concurrently (e.g. a REPL, another input source), pausing it here will silently break that module.

---

## Step 3 — CLIInputSource: Input Path

The `"data"` handler trims whitespace and skips empty strings. All non-empty input is emitted as `direct_input`. This is intentionally simple: the CLI model assumes every line typed is addressed to the agent.

There is no handling of the stream's `"end"` or `"close"` events (i.e. when the user presses Ctrl-D / EOF). When stdin closes, the agent silently stops receiving input with no notification — no event is emitted, no log is written, and the agent continues running its heartbeat tick loop indefinitely.

---

## Step 4 — MicrophoneInputSource: Construction and Configuration

`MicrophoneInputSourceOptions` exposes three fields:

- `energyThreshold` — passed to `VoiceActivityDetector`. No JSDoc, unlike the other two fields.
- `noSpeechThreshold` — Whisper probability cutoff, defaults to `0.7`. Documented.
- `ignoreAmbient` — whether to drop ambient sound markers, defaults to `false`. Documented.

`audioSystem` is typed `AudioSystem | undefined` because it is assigned in `start()`, not the constructor. This means `stop()` must guard with optional chaining (`this.audioSystem?.stop()`), which it does. However, `handleSpeech` is registered as a listener before `start()` completes and could theoretically fire during an async gap, though the current `AudioSystem.start()` appears synchronous enough that this is not a practical issue.

---

## Step 5 — MicrophoneInputSource: start() Path

`start()` constructs the full audio pipeline inline:

1. `selectAudioDevice()` — async device selection
2. `new AudioProvider(device)` — wraps the chosen device
3. `new VoiceActivityDetector(...)` — uses `energyThreshold` and hardcodes `silenceDurationMs: 5000`
4. `new WhisperLocalProvider()` — no configuration passed
5. `new AudioSystem(...)` — wires them together and starts capture

The `silenceDurationMs: 5000` value is hardcoded inside `start()` with no corresponding option in `MicrophoneInputSourceOptions`. A caller who wants a different silence window cannot override it without subclassing or editing the source.

Similarly, `WhisperLocalProvider` receives no configuration, meaning model path, language, and other Whisper parameters are fixed at the provider level — not surfaced through `MicrophoneInputSource`.

---

## Step 6 — MicrophoneInputSource: handleSpeech Branching

The `handleSpeech` method applies two filters in sequence:

**Branch 1 — Ambient marker detection.** Whisper emits bracketed or parenthesized strings for non-speech audio (e.g. `[BLANK_AUDIO]`, `(music)`). The detection logic checks `text.startsWith("[") && text.endsWith("]")` or the parenthesis equivalent. This is a heuristic: it would misclassify a real utterance that starts and ends with brackets, e.g. `[laughing]` spoken by the user. It also does not match multi-line strings with embedded brackets.

If the text is an ambient marker and `ignoreAmbient` is false, it is emitted as `ambient_input` with the prefix `[Ambient sound: ...]`. If `ignoreAmbient` is true, the event is silently dropped and `return` is called early — neither logging nor any indication reaches the caller.

**Branch 2 — No-speech probability filter.** If `noSpeechProb` exceeds the threshold, the transcription is discarded with a `debug`-level log. No `ambient_input` is emitted, which is consistent with the intent (the audio was not speech), but also means the agent receives no signal that audio was detected at all.

Transcriptions that pass both filters are emitted as `direct_input`. All microphone speech is treated as direct (requiring a response), with no intent classification at this layer. The JSDoc comment correctly notes that directed-vs-overheard classification belongs in `AudioPlugin`.

---

## Step 7 — Lifecycle: stop() Is Never Called by BaseAgent

`BaseAgent` stores registered input sources in `this.inputSources` and calls `source.start()` for each during `BaseAgent.start()`. However, `BaseAgent` has no `stop()` method, meaning `source.stop()` is **never called** by the framework. The only way to stop a source is for the caller to hold an explicit reference (as `AgentFactory` does for `CLIInputSource`) and call `stop()` manually.

This means:
- Microphone capture continues indefinitely unless the process exits or the caller manually stops it.
- `CLIInputSource`'s listener remains attached to `process.stdin` for the process lifetime.
- If the agent is paused or replaced, its input sources keep firing events into it.

There is no documented expectation that callers must manage source lifecycle, and no warning in `addInputSource` that sources must be stopped externally.

---

## Step 8 — Integration: Event Wiring in BaseAgent

`BaseAgent.addInputSource()` (lines 38–43) attaches two anonymous arrow functions as listeners:

```ts
source.on("direct_input", (text: string) => this.addDirect(text));
source.on("ambient_input", (text: string) => this.addAmbient(text));
```

Because the listeners are anonymous closures, there is no way to call `source.removeListener(...)` later. Even if `BaseAgent` were given a `stop()` method, it could not detach these listeners without keeping references at registration time. This permanently binds the source to the agent instance.

Additionally, `addInputSource` is callable at any time — before or after `start()`. A source added after `start()` will not have its own `start()` called automatically; it will emit events but never be started. This is a silent misconfiguration with no guard or warning.

---

## Step 9 — Integration: CortexAgent and AgentFactory

`CortexAgent.addInputSource` delegates directly to `this.inner.addInputSource`, adding no additional logic. It is correctly typed to return `this` for chaining.

`AgentFactory` creates a `CLIInputSource` and registers it via `agent.addInputSource(input)`. It also returns `input` alongside `agent` so the caller can hold a reference. In practice, `index.ts` calls `agent.start()` (which starts the source) but there is no evidence of `input.stop()` being called on shutdown.

`MicrophoneInputSource` is defined but not wired into any factory — it is available for direct use but not demonstrated in the main agent setup.

---

## Summary Table

| Area | Severity | Issue |
|---|---|---|
| `InputSource` event contract | Medium | Event names (`direct_input`, `ambient_input`) and payload types are untyped; typos compile silently and produce runtime no-ops |
| `CLIInputSource.start()` | High | Attaching a second listener to the global `process.stdin` on repeated `start()` calls causes duplicate events; no guard exists |
| `CLIInputSource.stop()` | High | `"data"` listener is not removed in `stop()`; resumed stdin will re-fire the handler |
| `CLIInputSource.stop()` | Medium | `process.stdin.pause()` is a process-global side effect that can break unrelated stdin consumers |
| `CLIInputSource` | Medium | No handling of stdin `"end"` / `"close"` (Ctrl-D / EOF); agent silently stops receiving input with no notification |
| `MicrophoneInputSource.start()` | Low | `silenceDurationMs: 5000` is hardcoded with no corresponding option in `MicrophoneInputSourceOptions` |
| `MicrophoneInputSource` | Low | `WhisperLocalProvider` is constructed with no options; model path, language, etc. are not configurable through this layer |
| `MicrophoneInputSource.handleSpeech` | Low | Ambient marker detection is a heuristic (`startsWith("[")` etc.) that would misclassify real speech matching the pattern |
| `MicrophoneInputSource` options | Low | `energyThreshold` field has no JSDoc comment, unlike the other two options |
| `BaseAgent` lifecycle | High | `source.stop()` is never called by the framework; sources run indefinitely unless the caller holds and stops them manually |
| `BaseAgent.addInputSource()` | Medium | Anonymous closures prevent listener removal; permanent binding with no detach path |
| `BaseAgent.addInputSource()` | Medium | Sources added after `start()` are never started; silent misconfiguration with no guard |
| `name` field | Low | No validation that `name` is non-empty or unique across sources on the same agent |
