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

**HeadlessAgent** (`src/core/HeadlessAgent.ts`) is a stateless, single-call agent with no tick loop or input sources. It exposes one method — `ask(task: string): Promise<string>` — and is used as the building block for sub-agents. Plugins that rely on `onMessage`, `getMessages`, or `augmentResponse` are not invoked; the agent is task-in/result-out.

**Agent Factories** compose an agent with specific plugins for a use case:
- `AgentFactory.ts` — 2b CLI chat agent; orchestrates four domain sub-agents via `SubAgentPlugin` plus `MinimalTools` (inline plain-object plugin — not a class or standalone file) and `MemoryPlugin`

## Orchestrator + Sub-agent Pattern

The 2b agent uses an **orchestrator with sub-agents as tools** pattern. Rather than registering all capability plugins directly, the orchestrator registers `SubAgentPlugin` instances that each wrap a `HeadlessAgent`:

```
User → Orchestrator (CortexAgent)
           ├── media_agent  → HeadlessAgent [YtDlp, FFmpeg, ImageVision]
           ├── web_agent    → HeadlessAgent [WebSearch, WebReader]
           ├── system_agent → HeadlessAgent [Shell, FileIO, Clipboard, CodeSandbox]
           ├── info_agent   → HeadlessAgent [TMDB, Weather, Wikipedia]
           ├── MinimalTools (get_current_time, echo)
           └── MemoryPlugin
```

Sub-agent tool calls are forwarded to the orchestrator's `tool_call` event via `setToolCallHandler`, so they appear in the same `[tool]` output as primary agent calls.

Sub-agent factories live in `src/agents/sub-agents/`. Each factory takes an `LLMProvider` and returns a `HeadlessAgent` configured with a focused system prompt.

### Adding a new sub-agent

1. Create `src/agents/sub-agents/create<Name>Agent.ts` — instantiate `HeadlessAgent` with the relevant plugins and a focused system prompt
2. Register it in `AgentFactory.ts` via `new SubAgentPlugin({ toolName, description, agent, inactivityTimeoutMs?, absoluteTimeoutMs? })`

### Timeout options on SubAgentPlugin

| Option | Behaviour |
|---|---|
| `inactivityTimeoutMs` | Resets on each tool call; fires if the sub-agent goes quiet for this duration |
| `absoluteTimeoutMs` | Hard wall-clock cap on the entire `ask()` call |
| neither | No timeout — appropriate for long-running tasks like video downloads |

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

`ToolDefinition` also supports an optional `implementation` field for inline tool handlers (used by the `MinimalTools` plugin in `AgentFactory.ts`).

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

## Utilities

### `util.ts`
Exports `removeThinkTags(text, strict?)` — strips `<think>...</think>` blocks from model output.
- `strict: false` (default) — uses a flexible regex that handles leading/trailing whitespace
- `strict: true` — requires the tag to start at the beginning of the string

Used by callers that need clean prose before displaying or further processing the response.

### `lmstudioTools.ts`
Standalone `ToolDefinition` objects for the old LMStudio SDK tool format (pre-plugin architecture). Includes file I/O, note management, and datetime tools with safe path validation (cwd boundary checks). Retained for reference — not used by the current plugin-based agent.

## Adding a New Agent

1. Create a factory function in `src/agents/<Name>AgentFactory.ts`
2. Instantiate `CortexAgent(llm, config)` — `llm` is a `LMStudioProvider`, `config` has `name`, `cortexName`, `model`, `systemPrompt`
3. Register plugins via `agent.registerPlugin(new SomePlugin())`
4. Add an input source via `agent.addInputSource(new CLIInputSource())`
5. Wire it up in `index.ts`

`cortexName` determines the SQLite database filename: `data/<cortexName>.cortex.sqlite`.
