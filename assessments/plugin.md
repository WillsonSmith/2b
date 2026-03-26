# Assessment: Plugin.ts

**Files covered by this assessment:**

- `src/core/Plugin.ts` — primary subject
- `src/core/types.ts` — `Message` type referenced in interface
- `src/core/BaseAgent.ts` — primary consumer, implements the dispatch lifecycle
- `src/core/HeadlessAgent.ts` — secondary consumer, single-call execution path
- `src/core/CortexAgent.ts` — wraps `BaseAgent`, registers built-in plugins
- `src/providers/llm/LLMProvider.ts` — consumes `ToolDefinition` via `chat()`
- `src/plugins/MemoryPlugin.ts` — representative implementation of `getMessages`
- `src/plugins/SubAgentPlugin.ts` — representative implementation of `onInit` and `executeTool`
- `src/plugins/ImageVisionPlugin.ts` — representative implementation of `getTools` / `executeTool`
- `src/plugins/ThoughtPlugin.ts` — representative implementation of `onInit` and `getSystemPromptFragment`
- `src/plugins/CLAUDE.md` — plugin authoring conventions

---

## Step 1 — Interface Contract

`Plugin.ts` exports two interfaces: `ToolDefinition` and `AgentPlugin`.

### `ToolDefinition`

```ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any; // JSON Schema
  implementation?: (args: any) => any | Promise<any>;
}
```

`parameters` is typed as `any` with a comment noting it is JSON Schema. This means the compiler provides no structural guarantee that what a plugin author puts here is a valid JSON Schema object. The `implementation` field is optional and carries `any` for both input and output. The union `any | Promise<any>` is redundant — `any` already subsumes `Promise<any>` — and provides no contract to callers about whether the function is sync or async.

### `AgentPlugin`

All fields are optional except `name`. This design is intentional: plugins implement only the lifecycle hooks they need. The optional-everything approach is explicitly documented in `src/plugins/CLAUDE.md`.

Key method signatures:

- `onInit?(agent: BaseAgent)` — takes a concrete `BaseAgent`, not an interface or abstract type. Every plugin that needs agent access is tightly coupled to `BaseAgent`'s concrete surface.
- `getContext?(currentEvents?: string[])` — the parameter name `currentEvents` implies it receives discrete event strings, but at the call site in `BaseAgent.act()` it is passed `allInputs` (line 200), which is the concatenation of `direct` and `ambient` queues. The parameter name is misleading about what callers actually pass.
- `getTools?()` — returns `ToolDefinition[]` with no async capability. Plugins that need to determine tool availability dynamically based on external state (e.g., checking whether a binary is installed) cannot do so here.
- `executeTool?(name: string, args: any)` — returns `any | Promise<any>`. The `any | Promise<any>` union is again redundant. Returning `undefined` for unknown tool names is a convention documented in `CLAUDE.md` but is not encoded in the return type; a caller cannot distinguish "not my tool" from a void result.
- `onMessage?` — the `source` parameter type is `string`, not a union of known source identifiers. `BaseAgent` calls this with either `"input"` or `"direct"` as literals, but the type does not constrain this.
- `augmentResponse?(response: string)` — the most nuanced lifecycle hook. The JSDoc comment says "Return a modified string to replace the response, or the original string to leave it unchanged." However, `augmentResponse` is not implemented by any plugin in the codebase. It exists only in the interface and is called in `BaseAgent.act()`. This is dead interface surface from the plugin-author perspective.

---

## Step 2 — Type Accuracy and Escape Hatches

Four separate `any` usages appear across 33 lines:

1. `parameters: any` on `ToolDefinition` — the JSON Schema object is untyped.
2. `implementation?: (args: any) => any | Promise<any>` on `ToolDefinition` — both input and output are untyped.
3. `executeTool?: (name: string, args: any) => any | Promise<any>` on `AgentPlugin` — same pattern.
4. The `any | Promise<any>` redundancy appears in both places.

These `any` types propagate downstream. In `BaseAgent.act()` (line 219–221), the generated `t.implementation` function calls `plugin.executeTool!(toolName, args)` and returns its result directly to the LLM provider without any intermediate typing. In `LLMProvider`, the `tools` parameter is typed as `ToolDefinition[]`, so the untyped `parameters` and return values pass through to the provider unchanged.

The practical consequence is that schema validation of tool arguments is not enforced at the TypeScript level anywhere in the pipeline. A plugin author can provide a `parameters` object that is structurally invalid JSON Schema, and neither the compiler nor the runtime (absent explicit validation in the provider) will reject it.

---

## Step 3 — `onInit` Coupling

`onInit` accepts a `BaseAgent` instance. This binds every plugin that calls `onInit` to the concrete `BaseAgent` class rather than to an abstraction. In practice:

- `ThoughtPlugin.onInit` calls `agent.on("thought", ...)` — coupling to `BaseAgent`'s EventEmitter interface.
- `SubAgentPlugin.onInit` calls `agent.emit("tool_call", ...)` — coupling to `BaseAgent`'s event emission.

`HeadlessAgent` does not call `onInit` at all (confirmed in `HeadlessAgent.ts`). This means any plugin that relies on `onInit` for setup (e.g., subscribing to events, storing agent reference) will not initialise correctly when used inside a `HeadlessAgent`. `CLAUDE.md` documents which hooks `HeadlessAgent` omits (`onMessage`, `getMessages`, `augmentResponse`), but `onInit` is not listed as omitted — it is simply absent from `HeadlessAgent.ask()`. A plugin author reading the interface has no signal that `onInit` is silently dropped in the headless execution path.

---

## Step 4 — `getContext` Parameter Semantics

```ts
getContext?: (currentEvents?: string[]) => string | Promise<string>;
```

The parameter is named `currentEvents` and typed as `string[]`. In `BaseAgent.act()`, it is called as:

```ts
const ctx = await plugin.getContext(allInputs);
```

where `allInputs` is formed by:

```ts
const allInputs = [...direct, ...ambient];
```

These are raw text strings from the direct and ambient queues — they are user input strings, not discrete structured event objects. The name `currentEvents` suggests a structured event system. A plugin author implementing `getContext` based on the type signature alone would not expect to receive raw user input text.

`HeadlessAgent.ask()` passes `[task]` — a single-element array containing the whole task string. The semantics are therefore different between `BaseAgent` (multiple user inputs potentially concatenated) and `HeadlessAgent` (always a single-element array with the full task).

---

## Step 5 — `executeTool` Return Value Convention

The convention for `executeTool` returning `undefined` for unknown names is documented in `CLAUDE.md` but is absent from the type signature. The return type `any | Promise<any>` allows `undefined`, but nothing in the interface communicates that:

- `undefined` means "I don't handle this tool name"
- A non-undefined value means "here is the tool result"

`BaseAgent.act()` does not check whether `executeTool` returned `undefined`. The implementation wiring in `BaseAgent` (lines 217–222) only attaches `executeTool` as the `implementation` if the tool has no existing `implementation`. The actual dispatch — calling `implementation(args)` — is done inside `LLMProvider`. This means the provider, not `BaseAgent`, is what ultimately calls `t.implementation`. An `undefined` return from `executeTool` would propagate to the provider as the tool result with no error raised.

---

## Step 6 — `augmentResponse` — Dead Interface Surface

`augmentResponse` is defined in `AgentPlugin` and called in `BaseAgent.act()` (lines 257–264). However, no plugin in `src/plugins/` implements it. The feature exists, is called in the dispatch loop, and has no consumers. The JSDoc comment on `augmentResponse` mentions "routing to a vision model, a larger synthesis model" — this use case is likely covered instead by `ImageVisionPlugin` via the tool calling path rather than the response augmentation hook.

This creates a maintenance risk: future plugin authors reading the interface may implement `augmentResponse` without understanding that the contract "return a modified string to replace the response, or the original string to leave it unchanged" has an implicit edge case — if `augmentResponse` throws, `BaseAgent` logs the error and leaves `finalResponse` unchanged (the catch block at line 262 does not reset `finalResponse`). This behaviour is correct but is not documented.

---

## Step 7 — `getMessages` and Multiple Message Providers

The interface allows multiple plugins to implement `getMessages`. `BaseAgent.act()` iterates all plugins and appends each plugin's messages into a single `messages` array (lines 170–181). There is no deduplication, ordering guarantee, or conflict resolution between multiple message providers. `MemoryPlugin` and `CortexMemoryPlugin` both implement `getMessages`, and if both are registered on the same agent, their histories will be concatenated. `CortexAgent` registers `CortexMemoryPlugin` but not `MemoryPlugin`; the `CLAUDE.md` does not warn against registering both.

The `limit` parameter on `getMessages(limit?: number)` is passed from `AgentConfig.historyLimit ?? 20`. Each plugin that implements `getMessages` receives the same limit independently. If two message plugins are registered, each returns up to 20 messages, and the combined history grows to up to 40 messages, exceeding the intended cap.

---

## Step 8 — `onMessage` — No System Prompt Dispatch

`BaseAgent.act()` calls `dispatchMessage("user", userContent, "input")` before the LLM call and `dispatchMessage("assistant", finalResponse, "direct")` after it. The system prompt itself is never dispatched as a `"system"` role message to plugins. `MemoryPlugin.onMessage` has special handling for `role === "system"` — it stores the system prompt separately and re-injects it at the front of history. However, because `BaseAgent` never dispatches a system-role message, this branch in `MemoryPlugin` is dead code. The `"system"` role variant in the `onMessage` signature therefore creates a false impression of functionality that does not exist in the current lifecycle.

---

## Step 9 — `getTools` Synchronicity Constraint

`getTools()` is synchronous. This means plugins cannot lazily resolve tools based on async state (e.g., checking database flags, probing a running service, reading a config file). All tool definitions must be known at plugin construction time or maintained as pre-fetched synchronous state. This is a design constraint not documented in the interface or `CLAUDE.md`.

---

## Step 10 — Integration Context

`Plugin.ts` is the single shared contract between:

- `BaseAgent` — full lifecycle dispatch
- `HeadlessAgent` — partial lifecycle (omits `onInit`, `onMessage`, `getMessages`, `augmentResponse`)
- `CortexAgent` — thin wrapper that registers two built-in plugins (`CortexMemoryPlugin`, `ThoughtPlugin`) before delegating to `BaseAgent`
- All plugins in `src/plugins/`
- `LLMProvider` — consumes `ToolDefinition[]` via `chat()`

The interface has no versioning mechanism. Adding a new optional method to `AgentPlugin` is backward compatible, but removing or changing a method signature would require auditing all 20+ plugin implementations. The lack of a method-presence check pattern (e.g., a `version` field) means schema drift is not detectable at runtime.

---

## Summary Table

| Area | Severity | Issue |
|---|---|---|
| `ToolDefinition.parameters` | Medium | Typed as `any` with no JSON Schema structural guarantee; invalid schemas are not caught by the compiler or at registration time |
| `ToolDefinition.implementation` return | Low | `any \| Promise<any>` is a redundant union; `any` already subsumes `Promise<any>`; the sync/async nature is not contractually communicated |
| `AgentPlugin.executeTool` return | Low | Same redundant `any \| Promise<any>` union; `undefined`-means-unhandled convention is undocumented in the type system |
| `AgentPlugin.executeTool` undefined propagation | Medium | If `executeTool` returns `undefined` for a matched tool name (e.g., a bug), the result propagates to the LLM provider as the tool result with no error raised |
| `getContext` parameter name | Low | Parameter named `currentEvents` but receives raw user input text strings; misleads plugin authors about the nature of the argument |
| `getContext` semantic inconsistency | Low | `BaseAgent` passes multiple user input strings; `HeadlessAgent` always passes a single-element array; callers behave differently without any type distinction |
| `onInit` coupling to `BaseAgent` | Medium | `onInit` accepts concrete `BaseAgent`, binding plugins to the full agent class rather than an abstraction; `HeadlessAgent` silently skips `onInit` with no interface-level signal to plugin authors |
| `onInit` silently skipped in `HeadlessAgent` | High | Plugins relying on `onInit` for setup (event subscriptions, agent ref storage) will not initialise when used inside a `HeadlessAgent`; this is not documented on the interface or called out in `CLAUDE.md` |
| `augmentResponse` — no implementations | Low | Declared in the interface, called in `BaseAgent`, but no plugin implements it; creates misleading surface area for plugin authors |
| `augmentResponse` error behaviour | Low | If `augmentResponse` throws, the previous `finalResponse` is silently preserved; this correct-but-non-obvious behaviour is undocumented |
| `onMessage` "system" role branch | Medium | `BaseAgent` never dispatches a `"system"`-role message; the `"system"` role variant in the `onMessage` signature and `MemoryPlugin`'s handling of it are dead code; creates false impression of functionality |
| `getMessages` — multiple providers | Medium | Multiple plugins implementing `getMessages` have their histories concatenated without deduplication or ordering guarantees; the per-plugin `limit` cap can be individually applied, causing combined history to exceed `historyLimit` |
| `getMessages` limit semantics | Low | Each message provider plugin receives the same `limit` independently; two providers each returning 20 messages yields 40 messages total, silently exceeding `AgentConfig.historyLimit` |
| `getTools` synchronicity | Low | `getTools()` is synchronous; plugins cannot resolve tool availability via async state; constraint is not documented in the interface |
| `onMessage` `source` parameter | Low | `source` is typed as `string` rather than a union of known literals (`"input"` \| `"direct"`); plugin authors cannot exhaustively handle known source values |
| `onInit` `agent` parameter | Low | `onInit(agent: BaseAgent)` takes the concrete class rather than an interface; increases coupling and makes unit testing plugins harder without a full `BaseAgent` instance |
