# Core

Foundation of the agent framework. Everything else is built on top of these primitives.

## Key Files

| File | Purpose |
|------|---------|
| `BaseAgent.ts` | Event-driven orchestrator — input queues, plugin lifecycle, tool dispatch, LLM calls, tick loop |
| `CortexAgent.ts` | Wraps `BaseAgent` with `CortexMemoryPlugin` + `ThoughtPlugin` pre-registered; preferred for all new agents |
| `HeadlessAgent.ts` | Stateless single-call agent; no loop, no history — building block for sub-agents |
| `InputSource.ts` | Abstract base class for input providers (CLI, microphone) |
| `Plugin.ts` | `AgentPlugin` interface + `ToolDefinition` type |
| `PermissionManager.ts` | Permission approval abstraction + four concrete implementations |
| `types.ts` | `AgentConfig`, `AgentEventMap`, `Message`, `AmbientOptions` |

## BaseAgent

The central orchestrator. Manages two input queues:

- **directQueue** — requires an LLM response (`addDirect()`)
- **ambientQueue** — agent may reply `[IGNORE]` to skip (`addAmbient()`)

Each tick drains both queues, assembles a system prompt, calls the LLM, and emits results. A tick fires immediately on `addDirect()` or after `heartbeatInterval` (default 3s).

**System prompt assembly (per tick):**
1. `AgentConfig.systemPrompt` (base)
2. Must/must-not respond rules (depends on whether direct or ambient input is present)
3. `getContext()` from all plugins (async)
4. `getSystemPromptFragment()` from all plugins

**Tool dispatch:** tools collected from all plugins each tick, wrapped with permission checks before calling `executeTool()` on the owning plugin. Tools with `permission !== "none"` require `PermissionManager` approval.

**Events emitted** (`AgentEventMap`):
- `state_change` — `"idle"` | `"thinking"`
- `speak` — final LLM response text
- `thought` — extracted reasoning text (from `<think>` blocks)
- `tool_call` — `(name, args)` for every tool invocation
- `log` — structured log message
- `interrupt` — barge-in fired
- `error` — error from plugin or LLM

**Proactive tasks:** `scheduleProactiveTick(intervalMs, () => string | null)` — if the task function returns a string, it is enqueued as ambient input.

**Interrupt:** `interrupt()` aborts in-flight LLM inference via `AbortController`.

## CortexAgent

Thin wrapper around `BaseAgent`. Auto-registers `CortexMemoryPlugin` and `ThoughtPlugin`. Exposes the same API surface as `BaseAgent` (`registerPlugin`, `addInputSource`, `start`, `stop`, `addDirect`, `addAmbient`, `interrupt`, `setTokenCallback`, `scheduleProactiveTick`, `pause`, `resume`, `on`, `once`, `off`).

**Use `CortexAgent` for all new agents** unless you explicitly want to skip memory.

```typescript
const agent = new CortexAgent(llm, {
  name: "MyAgent",
  cortexName: "my-agent",   // determines SQLite filename: data/my-agent.cortex.sqlite
  model: "google/gemma-3-4b",
  systemPrompt: "You are ...",
  memoryDbPath: ":memory:", // override for tests
});
```

Multiple unnamed `CortexAgent` instances share the `"cortex"` namespace — always set `cortexName` (or `name`) when running more than one.

`CortexAgent` also accepts an optional `synthesisProvider` (second `LLMProvider`) passed to `ThoughtPlugin` for behavioral insight synthesis.

## HeadlessAgent

Stateless, single-call. No tick loop, no conversation history.

```typescript
const agent = new HeadlessAgent(llm, [plugin1, plugin2], "System prompt...", { agentName: "MyAgent" });
const result = await agent.ask("Do the task");
```

- `onInit`, `onMessage`, `getMessages`, `augmentResponse` hooks are **not called**
- `getSystemPromptFragment`, `getContext`, `getTools`, `executeTool` **are called** each `ask()`
- Tool calls forward through `toolCallHandler` if set (used by `SubAgentPlugin` to surface calls on the orchestrator's `tool_call` event)
- No `permissionManager` → tools with `permission !== "none"` are auto-denied (`AutoDenyPermissionManager`)

## InputSource

Abstract base (EventEmitter). Subclasses must implement `start()`, `stop()`, and set `this.running`.

```typescript
emit("direct_input", text)   // agent must respond
emit("ambient_input", text)  // agent may ignore
```

Guard against duplicate `start()` calls and premature `stop()` calls using `this.running`.

## AgentPlugin Interface

```typescript
interface AgentPlugin {
  name: string;
  onInit?(agent: BaseAgent): void | Promise<void>;
  getSystemPromptFragment?(): string;
  getContext?(currentEvents?: string[]): string | Promise<string>;
  getTools?(): ToolDefinition[];
  executeTool?(name: string, args: Record<string, unknown>): Promise<unknown>;
  onMessage?(role: "user" | "assistant" | "system", content: string, source: string): void | Promise<void>;
  getMessages?(limit?: number): Message[] | Promise<Message[]>;
  onError?(error: Error): void;
  augmentResponse?(response: string): string | Promise<string>;
}
```

`ToolDefinition` adds optional `implementation` (for inline tools) and `permission` (`"none" | "per_call" | "session"`).

**All plugin hook calls are wrapped in try-catch** — a throwing plugin never crashes the agent.

## PermissionManager

```typescript
interface PermissionManager {
  requestApproval(request: PermissionRequest): Promise<boolean>;
  isSessionApproved(toolName: string): boolean;
}
```

| Implementation | Use |
|---|---|
| `InteractivePermissionManager` | Production — prompts stdin with y/a/n; auto-denies after 30s timeout |
| `AutoDenyPermissionManager` | Default when no manager is configured — logs a warning and denies |
| `AutoApprovePermissionManager` | Tests only — always approves |
| `ScriptedPermissionManager` | Tests — scripted responses per tool name |

`SessionCache` is a simple `Set<string>` for session-level approvals. `InteractivePermissionManager`'s `[a]lways` option adds to the cache regardless of the tool's `permission` annotation — user intent overrides the annotation.

## AgentConfig

```typescript
interface AgentConfig {
  model: string;
  embeddingModel?: string;
  systemPrompt: string;
  toolCallingStrategy?: "native" | "structured_output"; // default: "native"
  heartbeatInterval?: number;  // ms, default 3000
  historyLimit?: number;
  name?: string;
  cortexName?: string;
  memoryDbPath?: string;       // pass ":memory:" in tests
  permissionManager?: PermissionManager;
}
```

## Gotchas

- `CortexAgent` is a façade, not a subclass of `BaseAgent`. It holds `inner: BaseAgent` and proxies all methods. Subscribe to events with `agent.on(...)` — this goes through to `inner`.
- `cortexName` (or `name`) determines the SQLite file path. Omitting it causes all agents to share `data/cortex.cortex.sqlite`.
- `HeadlessAgent` does not call `onInit` — plugins must be fully initialized before being passed in (constructors must not do I/O; see plugin conventions in `src/plugins/CLAUDE.md`).
- `addPerception()` on `BaseAgent` is a backward-compat shim — prefer `addDirect()` / `addAmbient()` for new code.
