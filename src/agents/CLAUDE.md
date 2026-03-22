# Agents

This directory contains agent factory functions and input sources. The core agent classes (`BaseAgent`, `CortexAgent`, `Plugin`) live in `src/core/`.

## Architecture

**BaseAgent** (`src/core/BaseAgent.ts`) is the central orchestrator. It manages:
- A direct input queue (requires LLM response) and ambient input queue (agent may ignore with `[IGNORE]`)
- Plugin registration and lifecycle
- System prompt assembly from plugin fragments
- Tool collection and dispatch to plugins
- LLM conversation history and chat calls
- `<think>` tag extraction for UI display
- Interrupt mechanism for barge-in (mid-response cancellation)

**CortexAgent** (`src/core/CortexAgent.ts`) wraps `BaseAgent` and automatically registers `CortexMemoryPlugin` and `ThoughtPlugin`. All new agents should use `CortexAgent`.

**Agent Factories** compose an agent with specific plugins for a use case:
- `AgentFactory.ts` — 2b CLI chat agent with tools, memory, vision, and TMDB (CortexAgent)

## Plugin Interface

All capabilities are injected via the `AgentPlugin` interface (see `src/core/Plugin.ts`):

```typescript
interface AgentPlugin {
  name: string;
  onInit?: (agent: BaseAgent) => void;
  getSystemPromptFragment?: () => string;
  getContext?: (currentEvents?: string[]) => string | Promise<string>;
  getTools?: () => ToolDefinition[];
  executeTool?: (name: string, args: any) => any | Promise<any>;
  onMessage?: (role: "user" | "assistant" | "system", content: string, source: string) => void | Promise<void>;
  getMessages?: (limit?: number) => Message[] | Promise<Message[]>;
  onError?: (error: Error) => void;
  augmentResponse?: (response: string) => string | Promise<string>;
}
```

`ToolDefinition` also supports an optional `implementation` field for inline tool handlers (used by `MinimalToolsPlugin` in `AgentFactory.ts`).

Plugins never crash the agent — all plugin calls are wrapped in try-catch.

## Input Sources

Input sources extend the abstract `InputSource` class (`src/core/InputSource.ts`) and emit events that BaseAgent enqueues:
- `CLIInputSource` — reads from stdin, emits all input as `direct_input`
- `MicrophoneInputSource` — wraps AudioSystem, classifies speech as direct vs. ambient via AudioPlugin

## Direct vs. Ambient Input

- **Direct**: User explicitly addressed the agent → LLM must respond
- **Ambient**: Overheard or incidental input → agent can reply `[IGNORE]` to skip

## System Prompt Assembly

Each LLM call assembles a fresh system prompt by concatenating:
1. `AgentConfig.systemPrompt` (base)
2. Must/must-not respond instructions (based on input type)
3. `getContext()` results from all plugins
4. `getSystemPromptFragment()` from all plugins

## Adding a New Agent

1. Create a factory function in `src/agents/<Name>AgentFactory.ts`
2. Instantiate `CortexAgent(llm, config)` — `llm` is a `LMStudioProvider`, `config` has `name`, `cortexName`, `model`, `systemPrompt`
3. Register plugins via `agent.registerPlugin(new SomePlugin())`
4. Add an input source via `agent.addInputSource(new CLIInputSource())`
5. Wire it up in `index.ts`

`cortexName` determines the SQLite database filename: `data/<cortexName>.cortex.sqlite`.
