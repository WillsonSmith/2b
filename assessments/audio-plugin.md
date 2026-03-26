# AudioPlugin Assessment

## Module Overview

`AudioPlugin` bridges the audio perception pipeline to the agent's cognitive loop. It subscribes to real-time speech transcription events produced by the `AudioSystem` and routes each utterance into one of four perceptual categories: ambient sound marker, background noise, overheard conversation, or a direct addressed command. When speech is determined to be directed at the agent, it triggers a barge-in interrupt and enqueues the text as a high-priority direct perception. This allows the agent to react to voice input without polling, and to ignore environmental noise without burdening the LLM with irrelevant information.

## Interface / Exports

### `class AudioPlugin implements AgentPlugin`

| Member | Signature | Purpose |
|---|---|---|
| `name` | `string = "Audio"` | Plugin identifier used in logs and system prompt assembly |
| `getContext()` | `() => string` | Returns system-prompt guidance for how to interpret bracketed sensory input; returns `""` when audio is not yet active |
| `onInit(agent)` | `(agent: BaseAgent) => void` | Subscribes to `"speech_detected"` events on the `AudioSystem` instance; sets `isActive = true` on first event |

No tools are registered (`getTools` is not implemented). The plugin operates entirely through perception injection rather than tool calls.

## Configuration

| Dependency | Type | Source |
|---|---|---|
| `audio` | `AudioSystem` | Constructor argument — the running audio pipeline |
| `llm` | `LLMProvider` | Constructor argument — used only for intent classification LLM calls |
| `isActive` | `boolean` | Internal private state; starts `false`, becomes `true` on first speech event |

No environment variables are used. The plugin requires a pre-constructed `AudioSystem` (which itself requires a microphone provider, VAD, and transcription provider) and an `LLMProvider`.

## Data Flow

```
Microphone hardware
  → AudioProvider (raw PCM chunks)
  → VoiceActivityDetector (utterance segmentation)
  → TranscriptionProvider (Whisper: {text, noSpeechProb})
  → AudioSystem emits "speech_detected"
  → AudioPlugin.onInit listener
      → Tier 1 / Tier 2 / Tier 3 classification
      → agent.addPerception(...) or agent.interrupt() + agent.addPerception(...)
  → BaseAgent perception queues → LLM tick
```

The `text` and `noSpeechProb` values come directly from the transcription result. The plugin never writes back to the audio system.

## Code Paths

### Tier 1 — Ambient Sound Marker
**Condition:** transcribed text starts with `[` and ends with `]`, or starts with `(` and ends with `)`.

These are formatting artifacts from Whisper indicating non-speech audio (e.g., `[Music]`, `(applause)`). The plugin wraps the text in an ambient perception tag and calls `agent.addPerception("[Ambient sound: ...]", { forceTick: false })`. No LLM call is made.

### Tier 2 — High No-Speech Probability
**Condition:** `noSpeechProb > 0.7`.

Whisper's own confidence that nothing intelligible was spoken. Routed as `[Background noise: ...]` with `forceTick: false`. No LLM call is made.

### Tier 3 — LLM Intent Classification
**Condition:** all other speech (presumed intelligible, not obviously Whisper-formatted noise).

The plugin calls `this.llm.chat(...)` with a short prompt asking the model to reply `YES` or `NO` based on whether the transcript is directed at the agent.

- **YES path:** `agent.interrupt()` cancels any in-progress LLM response (barge-in), then `agent.addPerception("[Heard \"text\"]", { forceTick: true })` enqueues the speech as a direct command.
- **NO path:** `agent.addPerception("[Overheard background conversation: \"text\"]", { forceTick: false })` adds the text as passive ambient context.

### Error path (intent classification failure)
If the LLM call throws, the catch block falls back to treating the audio as a direct command: `agent.interrupt()` + `agent.addPerception("[Heard \"text\"]", { forceTick: true })`. This is a safe-to-engage bias: it is better to accidentally respond to background noise than to miss a real command.

## Helper Functions / Internals

- `isActive: boolean` — private flag that gates the `getContext()` return value. Before any speech is detected, `getContext()` returns `""` so the system prompt is not polluted with audio instructions before the audio system is running.

No other private helpers exist. The logic is entirely inline in `onInit`.

## Error Handling

- Intent classification errors are caught and logged via `logger.error("Audio", ...)`.
- The fallback on error is a false-positive (treating overheard speech as directed), which is the safer of the two error modes.
- Transcription errors are handled upstream by `AudioSystem` and are not visible to this plugin.
- The plugin does not validate or sanitize the transcription `text` value before passing it into perception strings (see Observations).

## Integration Context

**Registered by:** This plugin is not currently wired into any sub-agent factory in the codebase. The `MicrophoneInputSource` file (`src/agents/input-sources/MicrophoneInputSource.ts`) explicitly notes that `AudioPlugin` is the correct component for intent classification, suggesting it is intended for a microphone-enabled main agent configuration rather than headless sub-agents.

**Depends on:**
- `src/providers/audio/AudioSystem.ts` — event source; emits `"speech_detected"` with `{ text: string, noSpeechProb: number }`
- `src/providers/llm/LLMProvider.ts` — used for `llm.chat()` intent classification
- `src/core/BaseAgent.ts` — target of `addPerception()` and `interrupt()` calls
- `src/logger.ts` — for debug and error logging

**Used by:** Main agent initialization code (not present in current sub-agent factories). Intended companion to `MicrophoneInputSource`.

## Observations / Notes

1. **Injection into perception strings:** The raw `text` value from the transcriber is embedded directly into the bracketed perception strings without escaping. A transcription that itself contains `"` characters or bracket characters could produce malformed perception tags that confuse the LLM or break the bracket-parsing convention.

2. **No deduplication or rate-limiting:** If the same ambient noise triggers repeated transcriptions (e.g., continuous background music), every event fires a Tier 1 or Tier 2 perception. This could inflate the agent's context with repetitive entries.

3. **LLM cost for every Tier 3 utterance:** Each piece of intelligible speech that is not obviously ambient triggers a full LLM round-trip for intent classification. This adds latency and inference cost before the agent even begins to process the command.

4. **`getContext()` returns static instructions:** The context fragment is hardcoded and does not adapt to the content of recent audio events. It is always the same string once `isActive` is true.

5. **`onInit` stores no agent reference:** The agent is captured only via the closure in the event listener callback. The plugin itself has no `agent` field, which is fine but worth noting — it cannot call agent methods outside of active speech events.

6. **Barge-in on error:** Defaulting to `interrupt()` on classification failure is a deliberate UX decision that values responsiveness over precision. It means a network or model error will cause the agent to interrupt itself unnecessarily, but will not cause a real command to be silently dropped.
