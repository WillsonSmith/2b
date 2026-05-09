# Agents

This directory contains the sub-agent factory used by `2b.ts` and supporting utilities. The core agent classes (`BaseAgent`, `CortexAgent`, `Plugin`) live in `src/core/`.

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

## Orchestrator + Dynamic Agent Pattern

The 2b agent uses a **dynamic agent system** rather than statically-registered sub-agents. The orchestrator has direct access to core capabilities and can spawn specialized sub-agents on demand via `DynamicAgentPlugin`:

```
User → Orchestrator (CortexAgent)
           ├── FileSystemPlugin    (direct — filesystem is infrastructure)
           ├── ShellPlugin         (direct — git/system queries)
           ├── DynamicAgentPlugin  (create_agent, call_agent, list_agents, list_capabilities)
           │     ├── preset: media      → HeadlessAgent [YtDlp, FFmpeg, ImageVision, Download]
           │     ├── preset: info       → HeadlessAgent [TMDB, Weather, Wikipedia, RSS]
           │     └── runtime agents     → HeadlessAgent or CortexSubAgent, created on demand
           ├── explore_codebase    → SubAgentPlugin wrapping CodebaseExplainerAgent (static)
           ├── MinimalTools        (get_current_time, echo)
           ├── ScratchPlugin
           └── MemoryPlugin
```

Preset agents are created at plugin init time (before the first user message) and are available immediately via `call_agent`. The AI can also create new specialized agents at runtime using `create_agent` with any combination of capability plugins.

Sub-agent tool calls are forwarded to the parent orchestrator's `subagent_tool_call` event, which carries `(agentName, agentToolName, toolName, args)` so the UI can attribute activity to the correct agent.

### Two dynamic agent types

| Type | Class | Memory | Use case |
|------|-------|--------|----------|
| `"headless"` | `HeadlessAgent` | `InMemoryDatabasePlugin` KV store only | Isolated one-shot tasks |
| `"cortex"` | `CortexSubAgent` | Full semantic memory, conversation history | Ongoing collaboration across multiple `call_agent` calls |

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

`ToolDefinition` also supports an optional `implementation` field for inline tool handlers (used by the `MinimalTools` inline plugin in `2b.ts`).

Plugins never crash the agent — all plugin calls are wrapped in try-catch.

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
2. Instantiate `CortexAgent(llm, config)` — `llm` is an `LLMProvider`, `config` has `name`, `cortexName`, `model`, `systemPrompt`
3. Register plugins via `agent.registerPlugin(new SomePlugin())`
4. Wire it up in `2b.ts` — input is handled by the terminal or web UI layer, not an input source class

`cortexName` determines the SQLite database filename: `data/<cortexName>.cortex.sqlite`.
