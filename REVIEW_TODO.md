# Modules Pending Review

Run `/review-module` on each of these.

## Core
- [x] `src/core/BaseAgent.ts`
- [x] `src/core/HeadlessAgent.ts`
- [x] `src/core/CortexAgent.ts`
- [x] `src/core/InputSource.ts`

## Providers
- [x] `src/providers/llm/LLMProvider.ts`
- [x] `src/providers/llm/LMStudioProvider.ts`
- [x] `src/providers/llm/StructuredToolCaller.ts`
- [x] `src/providers/audio/AudioProvider.ts`
- [x] `src/providers/audio/AudioSystem.ts`
- [x] `src/providers/audio/TranscriptionProvider.ts`
- [x] `src/providers/audio/VoiceActivityDetector.ts`

## Agents
- [x] `src/agents/AgentFactory.ts`
- [x] `src/agents/input-sources/CLIInputSource.ts`
- [x] `src/agents/lmstudioTools.ts`
- [x] `src/agents/util.ts`
- [x] `src/agents/sub-agents/createMediaAgent.ts`
- [x] `src/agents/sub-agents/createSystemAgent.ts`
- [x] `src/agents/sub-agents/createInfoAgent.ts`
- [x] `src/agents/sub-agents/createWebAgent.ts`

## Plugins
- [ ] `src/plugins/AudioPlugin.ts`
- [ ] `src/plugins/ClipboardPlugin.ts`
- [ ] `src/plugins/CodeSandboxPlugin.ts`
- [ ] `src/plugins/CortexMemoryDatabase.ts`
- [ ] `src/plugins/CortexMemoryPlugin.ts`
- [ ] `src/plugins/FileIOPlugin.ts`
- [ ] `src/plugins/IMemoryDatabase.ts`
- [ ] `src/plugins/ImageVisionPlugin.ts`
- [ ] `src/plugins/MemoryPlugin.ts`
- [ ] `src/plugins/NotesPlugin.ts`
- [ ] `src/plugins/RSSPlugin.ts`
- [ ] `src/plugins/ShellPlugin.ts`
- [ ] `src/plugins/TMDBPlugin.ts`
- [ ] `src/plugins/TimePlugin.ts`
- [ ] `src/plugins/WeatherPlugin.ts`
- [ ] `src/plugins/WebReaderPlugin.ts`
- [ ] `src/plugins/WebSearchPlugin.ts`
- [ ] `src/plugins/WikipediaPlugin.ts`
- [ ] `src/plugins/YtDlpPlugin.ts`

## Memory & Utils
- [x] `src/memory/MemoryProvider.ts`
- [x] `src/utils/stream-tts.ts`
- [x] `src/utils/deviceSelector.ts`

## CLI
- [x] `src/cli/memory-cmd.ts`
