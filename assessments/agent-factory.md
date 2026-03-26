# Assessment: AgentFactory

**Files covered by this assessment:**

- `src/agents/AgentFactory.ts` — primary subject
- `src/core/CortexAgent.ts`
- `src/core/BaseAgent.ts`
- `src/core/HeadlessAgent.ts`
- `src/core/Plugin.ts`
- `src/core/types.ts`
- `src/providers/llm/LMStudioProvider.ts`
- `src/plugins/MemoryPlugin.ts`
- `src/plugins/SubAgentPlugin.ts`
- `src/agents/input-sources/CLIInputSource.ts`
- `src/agents/sub-agents/createMediaAgent.ts`
- `src/agents/sub-agents/createWebAgent.ts`
- `src/agents/sub-agents/createSystemAgent.ts`
- `src/agents/sub-agents/createInfoAgent.ts`
- `index.ts` (sole caller of `createAgent()`)

---

## Step 1 — Interface Contract

`AgentFactory.ts` does not implement a named interface; instead, `createAgent()` is a plain factory function whose return type is declared inline as `{ agent: CortexAgent; input: CLIInputSource }`. There is no `IAgentFactory` interface, no abstract base, and no separation between the factory contract and its concrete implementation. The return type is concrete rather than structural, so callers are tightly bound to both `CortexAgent` and `CLIInputSource`.

The `AgentPlugin` interface that `MinimalToolsPlugin` satisfies is defined in `src/core/Plugin.ts`. The contract is weak in two relevant places:

- `ToolDefinition.parameters` is typed `any`. The factory passes bare object literals that conform to JSON Schema but there is no compile-time validation.
- `ToolDefinition.implementation` is `((args: any) => any | Promise<any>) | undefined`. The `echo` tool's implementation casts its argument as `{ text: string }` but the type system cannot enforce that the LLM will supply a conforming object.

`MinimalToolsPlugin` implements only `name` and `getTools()`. It has no `executeTool()`. This is valid: `BaseAgent` detects tools that already carry an `implementation` field and skips the `executeTool` fallback path. The pattern is documented in `src/agents/CLAUDE.md` and works correctly.

---

## Step 2 — Constructor / Configuration

`createAgent()` constructs one `LMStudioProvider`, one `CortexAgent`, one `CLIInputSource`, four `SubAgentPlugin` instances, one `MinimalToolsPlugin`, and one `MemoryPlugin`. All four sub-agent factories (`createMediaAgent`, `createWebAgent`, `createSystemAgent`, `createInfoAgent`) receive the same `llm` instance that the orchestrator uses.

### Model selection

```ts
const model = process.env.MODEL ?? "nvidia/nemotron-3-nano-4b";
```

The default model string is a specific, opinionated choice baked into the factory. There is no validation that the string is non-empty or matches any known model ID. If `MODEL` is set to an empty string or a whitespace-only value, it propagates silently to `LMStudioProvider` which will pass it to `client.llm.model()`. The SDK will then throw at runtime with no useful error message attributing the cause to `AgentFactory`.

### LM Studio URL

```ts
const lmStudioUrl = process.env.LM_STUDIO_URL ?? "http://127.0.0.1:1234";
```

`lmStudioUrl` is passed as the second argument to `LMStudioProvider`, but `LMStudioProvider`'s constructor ignores it — the parameter is named `_endpoint` with a leading underscore, and `LMStudioClient` is constructed with no endpoint argument, meaning it connects to its own hardcoded default. `LM_STUDIO_URL` thus has no effect. The variable is declared, read, and discarded.

### `AgentConfig` fields

`createAgent()` passes `name: "2b"` and `cortexName: "2b"`. These are both set to the same value. `cortexName` controls the SQLite filename (`data/2b.cortex.sqlite`). The `model` field is forwarded from the environment variable; it is used by `CortexMemoryPlugin` and `ThoughtPlugin` within `CortexAgent` when performing LLM-backed memory operations.

`AgentConfig` supports `heartbeatInterval` and `historyLimit` but neither is set by the factory, so `BaseAgent` falls back to its defaults (3000 ms heartbeat; 20-message history limit). This is functional but the defaults are invisible to readers of `AgentFactory.ts`.

`toolCallingStrategy` exists in `AgentConfig` but the factory does not pass it. The strategy is set on `LMStudioProvider` directly (`"native"`). The `AgentConfig` field is therefore dead as far as the factory is concerned; it is never read by `BaseAgent` or `CortexAgent`.

---

## Step 3 — Entry Point / Primary Method

`createAgent()` is a single function that performs all wiring in one pass. The responsibilities mixed together are:

1. Environment variable resolution
2. LLM provider construction
3. Orchestrator agent construction (including implicit `CortexMemoryPlugin` and `ThoughtPlugin` registration via `CortexAgent`)
4. Input source construction
5. Sub-agent construction (delegated to four factory helpers)
6. Plugin registration ordering
7. Return value assembly

There is no separation between configuration gathering and object construction. All four concerns happen sequentially in one flat scope. If the factory were to grow (e.g. conditional plugins based on env flags), this structure would require adding more branches into an already long function body.

The function never throws intentionally. LLM provider construction, `new CLIInputSource()`, and all plugin constructors currently do no I/O, so no error surface exists at construction time. Errors only surface when `agent.start()` is called by the caller (`index.ts`), which happens outside the factory.

---

## Step 4 — Each Major Code Path

### Sub-agent shared LLM instance

All four sub-agents receive the same `llm` object reference:

```ts
const llm = new LMStudioProvider(model, lmStudioUrl, { toolCallingStrategy: "native" });
// ...
agent: createMediaAgent(llm),
agent: createWebAgent(llm),
agent: createSystemAgent(llm),
agent: createInfoAgent(llm),
// ...
agent.registerPlugin(new MemoryPlugin(llm));
```

`LMStudioProvider` holds a single `LMStudioClient` instance and calls `this.client.llm.model()` on each `chat()` invocation. If the orchestrator and a sub-agent invoke the LLM concurrently — for instance, `MemoryPlugin.summarizeOldContext()` running during a `SubAgentPlugin.executeTool()` call — both share the same client. Whether `LMStudioClient` is thread-safe for concurrent requests is not documented here and depends on the SDK internals. No synchronisation is applied.

### Plugin registration order

Plugins are registered in this order:

1. `SubAgentPlugin` for `media_agent`
2. `SubAgentPlugin` for `web_agent`
3. `SubAgentPlugin` for `system_agent`
4. `SubAgentPlugin` for `info_agent`
5. `MinimalToolsPlugin`
6. `MemoryPlugin`

`CortexAgent` pre-registers `CortexMemoryPlugin` and `ThoughtPlugin` before any factory-registered plugin. Tool collection in `BaseAgent.act()` iterates plugins in insertion order, so tool name collision is resolved by whichever plugin appears first. There are no duplicate tool names between these plugins, but the ordering is implicit. A future plugin that accidentally reuses a name such as `get_current_time` (already in `MinimalToolsPlugin`) would silently shadow the later-registered tool.

`MemoryPlugin` is registered last. Its `getMessages()` is called during `BaseAgent.act()` to populate conversation history. Because `BaseAgent` iterates all plugins for `getMessages`, and `CortexMemoryPlugin` (registered first by `CortexAgent`) also implements `getMessages`, both plugins contribute message history. The combined history is concatenated and then a single user message appended — no deduplication occurs. In practice `CortexMemoryPlugin` returns long-term memories and `MemoryPlugin` returns short-term conversation history, so the concatenation is intentional, but this is nowhere documented in `AgentFactory.ts`.

### `MinimalToolsPlugin` inline tools

`get_current_time` takes no parameters; the schema declares `properties: {}` with no `required` array. This is valid JSON Schema (no required fields) and poses no risk.

`echo` requires `text`. If the LLM omits the argument, the `implementation` destructures `{ text }` from whatever object is passed. With `native` tool calling, the SDK enforces the schema; with `structured_output`, there is no equivalent enforcement and an undefined `text` would return `undefined` rather than a string.

### `media_agent` — no timeout

The `media_agent` sub-agent is deliberately registered without either timeout option:

```ts
// No timeouts — downloads and transcodes can take arbitrarily long.
```

This is documented in the comment. The consequence is that a single hung `yt-dlp` or `ffmpeg` process will cause the orchestrator's `executeTool` call to block indefinitely, preventing any further orchestrator response until the process completes or the user kills the process. No cancellation hook exists.

### `web_agent` timeout asymmetry

`web_agent` is configured with `inactivityTimeoutMs: 60_000` and `absoluteTimeoutMs: 120_000`. For a two-minute absolute cap, the inactivity timeout fires after one inactive minute. A task that makes tool calls every 59 seconds but runs for three minutes would still be cut off by the 120-second absolute limit. This seems intentional but is easy to misread: inactivity only resets on sub-agent _tool calls_, not on LLM token production. A slow-streaming response with no tool calls would trigger the inactivity timeout even if the model is still generating.

### `system_agent` timeout

`system_agent` has `inactivityTimeoutMs: 30_000` and `absoluteTimeoutMs: 120_000`. Shell commands can produce output without intermediate tool calls — for example, a long-running shell command is a single `executeTool` invocation. The absolute cap of 120 seconds may be too tight for commands like `find` over large filesystems, and the 30-second inactivity window starts from when `ask()` is called, before the shell command even completes.

### `info_agent` timeout

`info_agent` has the tightest timeouts: `inactivityTimeoutMs: 15_000` and `absoluteTimeoutMs: 30_000`. These appear reasonable for HTTP-based lookups (TMDB, weather, Wikipedia), but the 15-second inactivity window could fire during slow network responses before the sub-agent gets a chance to call a tool.

---

## Step 5 — Helper Functions

`MinimalToolsPlugin` is defined as a module-private class. It has no constructor logic and no state — it is effectively a namespace for two tool definitions. The class cannot be re-used or extended from outside the module because it is not exported. If a second consumer (a different agent factory) needed the same tools, they would have to duplicate the class or move it to a shared location.

The `echo` tool's stated purpose — "Echoes text back. Useful for confirming what the agent heard." — is a testing/debug aid, not a user-facing capability. Its presence in the production orchestrator increases the tool surface exposed to the model without adding user value. Models sometimes reach for the simplest tool available; `echo` could attract spurious tool calls.

The four sub-agent factory functions (`createMediaAgent`, `createWebAgent`, `createSystemAgent`, `createInfoAgent`) each follow the same structure: `new HeadlessAgent(llm, [...plugins], systemPromptBase)`. None of them expose configuration hooks. The system prompt, plugin set, and model are all fixed at call time. There is no way to pass runtime options (e.g. a different model for a specific sub-agent) without modifying the factory function directly.

---

## Step 6 — External Integrations

### `LMStudioClient` connection

`LMStudioProvider` ignores its `_endpoint` parameter and constructs `LMStudioClient` with no arguments, relying on the SDK's own default endpoint (localhost:1234). The factory reads and propagates `LM_STUDIO_URL` to `LMStudioProvider`, but because the provider ignores it, this environment variable is silently inoperative. A developer who sets `LM_STUDIO_URL` expecting to redirect traffic to a remote LM Studio instance will see no effect and receive no warning.

### Resource lifecycle

`CortexAgent` creates a `CortexMemoryPlugin` which opens a SQLite database (`data/2b.cortex.sqlite`) via `bun:sqlite`. There is no `close()` method on `CortexAgent` or `BaseAgent`, and `createAgent()` does not register a process exit handler to close the database. On clean exit the OS will release the file handle, but on a crash or `process.exit()` from `index.ts` (which is called on one-shot mode) any pending writes may be lost. `index.ts` calls `process.exit(0)` on the `speak` event in one-shot mode without awaiting any flush or teardown.

### `CLIInputSource` lifecycle

`CLIInputSource.start()` attaches a `data` listener to `process.stdin` and calls `process.stdin.resume()`. The returned `input` from `createAgent()` is destructured in `index.ts` as `const { agent }` — the `input` binding is unused. No caller calls `input.stop()`. There is no mechanism to detach the stdin listener, though in practice the process exits when done.

---

## Step 7 — Deployment / Integration Context

`createAgent()` is the sole factory in the codebase. It is called exactly once in `index.ts`. The `input` return value is never used by the caller — `index.ts` destructures only `agent`. This means the factory's return type advertises `CLIInputSource` as part of its API but no caller consumes it.

The `--model` flag in `index.ts` mutates `process.env.MODEL` before calling `createAgent()`. This is the mechanism by which the CLI overrides the model at runtime. The mutation-of-environment-variable pattern works but is non-obvious and prevents `createAgent()` from being called a second time with different arguments in the same process.

The factory creates a singleton `LMStudioProvider` shared across all agents. There is no way to give a specific sub-agent a different model or provider without altering the factory. For example, `ImageVisionPlugin` within `media_agent` likely benefits from a vision-capable model distinct from the text model. Currently it shares the orchestrator's model.

The `CortexAgent` constructor adds `synthesisProvider: LLMProvider | null = null` as an optional third parameter. `createAgent()` does not pass it, so `ThoughtPlugin` receives `null` and falls back to the same model for thought synthesis. This is probably intentional but is invisible from reading `AgentFactory.ts` alone.

`MinimalToolsPlugin` duplicates `get_current_time`. A `TimePlugin` exists in the codebase (noted in `src/plugins/CLAUDE.md`) but is not used here. `MinimalToolsPlugin` provides a subset of `TimePlugin`'s behaviour inline, creating two divergent implementations.

---

## Step 8 — Error Handling and Visibility

`createAgent()` itself performs no error handling. All construction is synchronous and no I/O occurs inside the factory, so errors during `createAgent()` would be uncaught exceptions propagating to `index.ts`.

When a sub-agent call times out, `SubAgentPlugin.executeTool()` rejects with an `Error` whose message is `"<toolName> timed out due to inactivity"` or `"<toolName> exceeded absolute timeout of Nms"`. This error propagates up through `LMStudioProvider.actWithTools()`, which catches _all_ errors and returns them as a string response: `"Tool error: <message>"`. The orchestrator therefore sees a successful tool result containing an error message rather than a thrown exception. This means the LLM receives a `Tool error: web_agent timed out due to inactivity` string as a tool result and must interpret it as a failure — there is no structural failure signal.

`MemoryPlugin.summarizeOldContext()` makes a bare `this.llm.chat()` call with no tools and no abort controller. If the LLM is unavailable during summarization, `MemoryPlugin` catches the error and falls back to silently dropping old messages. This is safe but invisible — there is no log entry at warn level, only at error level if the call throws, and the user receives no indication that history was truncated without a summary.

`MinimalToolsPlugin`'s `echo` implementation can return `undefined` if the LLM passes args without a `text` property. `undefined` serialised as a tool result may cause unexpected LLM behaviour.

---

## Summary Table

| Area | Severity | Issue |
|---|---|---|
| Configuration | High | `LM_STUDIO_URL` environment variable is read and passed to `LMStudioProvider` but the provider ignores it (`_endpoint` parameter is unused). Operator configuration has no effect and no warning is emitted. |
| Error handling | High | Sub-agent timeout errors are caught by `LMStudioProvider` and converted to a tool result string (`"Tool error: …"`). The orchestrator LLM receives a success-shaped response with an error message embedded; there is no structured failure signal. |
| Resource lifecycle | High | `process.exit(0)` is called in one-shot mode immediately on the `speak` event. The SQLite database opened by `CortexMemoryPlugin` has no `close()` call; pending writes may be lost on abrupt exit. |
| Configuration | Medium | `MODEL` env var is not validated for emptiness or whitespace. An empty `MODEL` string propagates to the LM Studio SDK, producing a runtime error with no attribution to the factory. |
| Architecture | Medium | The single `LMStudioProvider` instance is shared across the orchestrator and all four sub-agents plus `MemoryPlugin`. Concurrent LLM calls (e.g. summarization during a sub-agent task) share one client with no synchronisation. SDK concurrency safety is undocumented. |
| Integration | Medium | The `input` value in the factory return type (`{ agent, input }`) is never used by `index.ts`. The return type advertises a public interface that no caller consumes, creating a misleading API surface. |
| Integration | Medium | `MinimalToolsPlugin` is module-private and not exported. Any second factory that needs `get_current_time` or `echo` must duplicate or relocate the class. |
| Architecture | Medium | `AgentConfig.toolCallingStrategy` is unused by `BaseAgent` and `CortexAgent`. The strategy is set only on `LMStudioProvider`. The dead field in the config type will mislead future developers. |
| Error handling | Medium | `echo` tool returns `undefined` if the LLM omits the `text` argument (possible under `structured_output` strategy where schema is not enforced). `undefined` is serialised as a tool result and may confuse the model. |
| Architecture | Low | `createAgent()` mixes environment resolution, LLM construction, sub-agent wiring, and plugin registration in one flat function with no internal structure. Growth will require adding more branches to an already long scope. |
| Defaults | Low | `heartbeatInterval` (defaults to 3000 ms) and `historyLimit` (defaults to 20) are not set by the factory. The effective values are invisible to a reader of `AgentFactory.ts`. |
| Duplication | Low | `MinimalToolsPlugin` provides `get_current_time` inline, duplicating the responsibility of `TimePlugin` which exists in the codebase but is not used here. Two divergent implementations of the same tool exist. |
| Timeout policy | Low | `system_agent` inactivity timeout (30 s) starts from when `ask()` is called. Long-running single shell commands will trigger it before any tool result is returned, since inactivity only resets on tool calls, not on streaming output. |
| Timeout policy | Low | `media_agent` has no timeout. A hung `yt-dlp` or `ffmpeg` process blocks the orchestrator indefinitely with no cancellation path. The comment acknowledges this but the user impact is not bounded. |
| Naming | Low | `cortexName` and `name` are both set to `"2b"`. The distinction between the two fields (one affects the SQLite filename, the other is a display name) is not apparent from `AgentFactory.ts` alone. |
