# Assessments

This directory contains detailed step-by-step code assessments for different parts of the 2b codebase.

## Purpose

These assessments are produced during active codebase review. Each file covers a specific module or subsystem, documenting design decisions, identifying issues, and classifying their severity. They are intended to inform refactoring priorities and surface non-obvious problems before they become bugs.

## Format

Each assessment file:
- Identifies the files under review at the top
- Walks through the code in logical steps (interface contract → implementation → integration)
- Calls out specific line numbers where relevant
- Ends with a summary table of issues, each tagged with a severity: **Low**, **Medium**, or **High**

## File Naming

Files are named after the module they cover, e.g. `lmstudio-provider.md` for `src/providers/llm/LMStudioProvider.ts`.

## Index

| File | Covers |
|---|---|
| [lmstudio-provider.md](./lmstudio-provider.md) | `LMStudioProvider`, `LLMProvider` interface, `StructuredToolCaller` |
| [agent-factory.md](./agent-factory.md) | `AgentFactory`, `CortexAgent`, `BaseAgent`, `HeadlessAgent`, `SubAgentPlugin`, `MemoryPlugin`, `MinimalToolsPlugin`, all sub-agent factories |
| [cortex-agent.md](./cortex-agent.md) | `CortexAgent`, `BaseAgent`, `CortexMemoryPlugin`, `ThoughtPlugin`, `CortexMemoryDatabase`, `AgentConfig`, `AgentPlugin` |
| [base-agent.md](./base-agent.md) | `BaseAgent`, `Plugin`, `InputSource`, `types`, `LLMProvider`, `CortexAgent`, `HeadlessAgent`, `AgentFactory`, `SubAgentPlugin`, `AudioPlugin` |
| [headless-agent.md](./headless-agent.md) | `HeadlessAgent`, `AgentPlugin`, `LLMProvider`, `SubAgentPlugin`, all sub-agent factories |
| [input-source.md](./input-source.md) | `InputSource`, `CLIInputSource`, `MicrophoneInputSource` |
| [plugin.md](./plugin.md) | `Plugin` (`AgentPlugin`, `ToolDefinition`), `BaseAgent`, `HeadlessAgent`, `CortexAgent`, `LLMProvider`, `MemoryPlugin`, `SubAgentPlugin`, `ImageVisionPlugin`, `ThoughtPlugin` |
| [structured-tool-caller.md](./structured-tool-caller.md) | `StructuredToolCaller` (`buildToolSystemPromptAddition`, `callWithStructuredTools`), `LMStudioProvider`, `LLMProvider`, `ToolDefinition`, `ChatResponse` |
| [index.md](./index.md) | `index.ts`, `AgentFactory`, `CLIInputSource`, `memory-cmd`, `CortexAgent`, `BaseAgent`, `AgentEventMap` |
