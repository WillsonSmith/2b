# Providers

Backend adapters for LLM inference and audio capture/transcription. Nothing in this directory knows about agents or plugins.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `llm/` | `LLMProvider` interface + `LMStudioProvider` + `StructuredToolCaller` |
| `audio/` | Microphone capture, voice activity detection, and Whisper transcription |

## Dependencies

- **Depends on:** nothing in `src/` except `../logger.ts` and `../core/types.ts`
- **Depended on by:** `src/core/BaseAgent.ts`, `src/core/HeadlessAgent.ts`, `src/agents/input-sources/MicrophoneInputSource.ts`, `src/plugins/CortexMemoryPlugin.ts`

## Adding a New LLM Provider

Implement `LLMProvider` from `llm/LLMProvider.ts` and pass an instance to `BaseAgent` or `HeadlessAgent`. No changes needed elsewhere.

## Adding a New Transcription Provider

Implement `TranscriptionProvider` from `audio/TranscriptionProvider.ts` and pass it to `AudioSystem`.
