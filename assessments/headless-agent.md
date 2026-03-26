# HeadlessAgent Assessment

## Files Covered

- `src/core/HeadlessAgent.ts` (target)
- `src/core/Plugin.ts` (interface definitions)
- `src/core/types.ts` (type definitions)
- `src/providers/llm/LLMProvider.ts` (LLM integration)
- `src/providers/llm/LMStudioProvider.ts` (implementation detail)
- `src/plugins/SubAgentPlugin.ts` (primary consumer)
- `src/agents/sub-agents/createWebAgent.ts` (factory example)
- `src/agents/sub-agents/createSystemAgent.ts` (factory example)
- `src/agents/sub-agents/createInfoAgent.ts` (factory example)
- `src/agents/sub-agents/createMediaAgent.ts` (factory example)
- `src/core/BaseAgent.ts` (context for comparison)
- `src/logger.ts` (logging dependency)

---

## Step 1 — Interface Contract

`HeadlessAgent` does not implement any formal interface. It is a concrete class exposing two public methods:

- `setToolCallHandler(fn: (name: string, args: any) => void): void` — registers an optional callback that fires whenever the LLM invokes a tool. Used by `SubAgentPlugin` to observe sub-agent tool calls.
- `ask(task: string): Promise<string>` — the sole entry point. Accepts a task description and returns the LLM's response as a plain string.

No interface contract is defined or enforced. There is no common `HeadlessAgent` interface that would allow substitution or mocking in tests. The class header documents the intended usage pattern (stateless, single-call, no history), but this is commentary, not a contractual guarantee.

**Type safety concerns:**
- The `toolCallHandler` callback's `args` parameter is `any`, with no schema validation.
- `plugins` is typed as `AgentPlugin[]` but no runtime checks confirm each plugin satisfies the contract.
- The return type `Promise<string>` is accurate and tight.

---

## Step 2 — Constructor / Configuration

```typescript
constructor(
  private readonly llm: LLMProvider,
  private readonly plugins: AgentPlugin[],
  private readonly systemPromptBase: string,
)
```

All three parameters are required, positional, and `readonly` after construction.

- **`llm`** — the LLM backend; injected directly with no wrapping or validation.
- **`plugins`** — array of capability plugins. Order matters: plugins are iterated in insertion order for system prompt fragments, context, and tool collection.
- **`systemPromptBase`** — raw string with no normalization or length validation.

The constructor performs no I/O and has no error handling for invalid inputs (null `llm`, empty plugin name, etc.). Plugin `onInit` hooks are not called here; that responsibility is delegated to `SubAgentPlugin.onInit()` or the external caller.

No dead or misleading parameters were identified.

---

## Step 3 — Entry Point: `ask()`

`ask(task: string)` is the sole public entry point and runs a linear 4-phase sequence:

1. **System prompt assembly** — collect plugin fragments and dynamic context; combine with `systemPromptBase`
2. **Tool collection** — gather tool definitions from plugins and wire `executeTool` as the fallback implementation
3. **LLM call** — build a single-message conversation and invoke `llm.chat()`
4. **Return** — extract and return `nonReasoningContent`

The method is 57 lines and mixes three coherent concerns (prompt assembly, tool wiring, LLM invocation) into a single function. For a "stateless single-call agent" this is pragmatic, but the combination makes isolated unit testing difficult.

---

## Step 4 — Code Path: System Prompt Assembly (lines 25–49)

**Fragment collection:**
```typescript
const fragments: string[] = [];
for (const plugin of this.plugins) {
  const fragment = plugin.getSystemPromptFragment?.();
  if (fragment) fragments.push(fragment);
}
```
Optional chaining safely skips plugins that do not implement `getSystemPromptFragment`. Falsy results are filtered. No validation that a fragment is a string or within a reasonable length.

**Context collection:**
```typescript
for (const plugin of this.plugins) {
  if (plugin.getContext) {
    try {
      const ctx = await plugin.getContext([task]);
      if (ctx) pluginContext += `\n${plugin.name}: ${ctx.trim()}`;
    } catch (e) {
      logger.error("HeadlessAgent", `Plugin error in ${plugin.name}:`, e);
    }
  }
}
```
Plugin context errors are caught and logged but execution continues silently. If a plugin's context is critical to correctness, the failure is invisible to the caller. `ctx.trim()` assumes `ctx` is a string; if a plugin returns a non-string truthy value this will throw at runtime.

**Final assembly:**
```typescript
const parts = [this.systemPromptBase];
if (pluginContext.trim()) parts.push(`Plugin Context:\n${pluginContext.trim()}`);
if (fragments.length > 0) parts.push(fragments.join("\n"));
const systemPrompt = parts.filter(Boolean).join("\n\n");
```
`filter(Boolean)` is redundant since each part is explicitly guarded before being added. The label `Plugin Context:` is hardcoded and not configurable.

---

## Step 5 — Code Path: Tool Collection (lines 51–67)

```typescript
const tools: ToolDefinition[] = [];
for (const plugin of this.plugins) {
  if (plugin.getTools) {
    const pluginTools = plugin.getTools();
    for (const t of pluginTools) {
      if (!t.implementation && plugin.executeTool) {
        const toolName = t.name;
        t.implementation = (args) => {
          this.toolCallHandler?.(toolName, args);
          return plugin.executeTool!(toolName, args);
        };
      }
    }
    tools.push(...pluginTools);
  }
}
```

**Closure capture:** `toolName` is correctly captured per iteration, preventing all closures from sharing the last tool's name.

**Implementation mutation:** The `implementation` property is written directly onto the tool object returned by `getTools()`. If the same plugin instance is registered on multiple `HeadlessAgent` instances, the mutation from one instance may affect another.

**`toolCallHandler` invocation order:** The handler fires before `executeTool`; if the handler throws, `executeTool` is never called. The handler must not throw.

**Tool name collision:** If multiple plugins define tools with the same name, both definitions are added to the `tools` array. The LLM receives duplicate tool names, which results in undefined behavior.

**Missing null guards:** If `getTools()` returns `null` or `undefined`, iterating it will throw. No runtime check prevents this.

---

## Step 6 — Code Path: LLM Chat Invocation (lines 69–81)

```typescript
const messages: Message[] = [{ role: "user", content: task }];
logger.info("HeadlessAgent", `ask() — tools=[${tools.map((t) => t.name).join(", ")}]`);

const { nonReasoningContent } = await this.llm.chat(
  messages,
  systemPrompt,
  undefined,   // schema: structured output not supported
  tools,
  undefined,   // onToken: streaming not wired
);

return nonReasoningContent;
```

- `schema` is hardcoded to `undefined`; structured output is not supported.
- `onToken` is hardcoded to `undefined`; token streaming is not available to callers.
- `reasoningText` from the response is discarded with no logging or fallback logic.
- LLM errors are absorbed inside `LMStudioProvider` and returned as fallback strings; `ask()` always resolves, never rejects.

---

## Step 7 — Helper: `setToolCallHandler`

```typescript
setToolCallHandler(fn: (name: string, args: any) => void): void {
  this.toolCallHandler = fn;
}
```

Simple setter with no side effects. Issues:
- If called multiple times, the previous handler is silently overwritten.
- Must be called before `ask()` for tool calls to be observed; no runtime enforcement of this ordering.
- The field is mutable and shared across concurrent `ask()` calls on the same instance.

---

## Step 8 — Error Handling and Visibility

| Source | Handling | Caller visibility |
|---|---|---|
| `plugin.getContext()` throws | Caught, logged, skipped | None — ask() continues |
| `plugin.getTools()` returns null/undefined | Not caught — runtime crash | Exception propagates |
| `plugin.executeTool()` throws | Not caught in HeadlessAgent — caught in LMStudioProvider | Tool error returned as `{ error: msg }` to LLM |
| `llm.chat()` throws | Absorbed by LMStudioProvider; fallback string returned | None — ask() returns fallback as success |
| LLM returns empty content | Not handled | Caller receives empty string |

Callers cannot distinguish a legitimate LLM response from a fallback error message. There are no typed error classes, no rejected Promises, and no event emissions for failures.

---

## Step 9 — Deployment / Integration Context

`HeadlessAgent` is never instantiated directly. Domain-specific factory functions create configured instances:

| Factory | Plugins | Role |
|---|---|---|
| `createWebAgent()` | WebSearch, WebReader, Wikipedia, RSS | Web research |
| `createInfoAgent()` | TMDB, Weather, Notes | Movie/weather/notes lookups |
| `createSystemAgent()` | Shell, FileIO, Clipboard, CodeSandbox | System ops & code execution |
| `createMediaAgent()` | YtDlp, FFmpeg, ImageVision | Video/image processing |

Each factory instance is wrapped in a `SubAgentPlugin`, which:
1. Calls `setToolCallHandler` during `onInit` to wire tool calls back to the orchestrator.
2. Applies optional `inactivityTimeoutMs` and `absoluteTimeoutMs` via `Promise.race()`.
3. Exposes the agent as a single callable tool on the parent `BaseAgent`.

`SubAgentPlugin` documents that concurrent `executeTool()` calls on the same instance would race on internal state. This risk extends to `HeadlessAgent`'s mutable `toolCallHandler` field.

---

## Summary Table

| Area | Severity | Issue |
|---|---|---|
| Tool name collision | High | Multiple plugins defining tools with the same name both appear in the `tools` array. The LLM receives duplicate tool definitions; behavior is undefined. |
| `getTools()` null guard | High | If `getTools()` returns `null` or `undefined`, iterating it throws a runtime error. No guard exists. |
| Concurrent use — `toolCallHandler` race | High | `toolCallHandler` is a mutable field shared across `ask()` calls. Concurrent invocations on the same instance will race on this field. |
| Plugin context errors swallowed | Medium | Errors from `getContext()` are caught and logged but silently skipped. If context is critical, the caller sees no signal that the ask ran with incomplete context. |
| Tool object mutation | Medium | The `implementation` property is written directly onto tool objects returned by `getTools()`. If a plugin instance is shared across multiple `HeadlessAgent` instances, the mutation from one affects the other. |
| `toolCallHandler` must-be-set ordering | Medium | No runtime check enforces that `setToolCallHandler` is called before `ask()`. If not set, tool calls are silently no-ops (optional chaining on handler invocation). |
| `args: any` in tool handler | Medium | The `toolCallHandler` callback and `executeTool` both accept `args: any` with no schema validation. Type errors in tool arguments are invisible at compile time. |
| `ctx.trim()` type assumption | Medium | `ctx.trim()` is called without confirming `ctx` is a string. A non-string truthy value from a plugin would cause a runtime error. |
| LLM failure indistinguishable from success | Medium | `llm.chat()` errors are absorbed by `LMStudioProvider` and returned as fallback strings. Callers cannot distinguish a real response from an error fallback. |
| No formal interface | Low | `HeadlessAgent` does not implement a named interface, making it impossible to substitute or mock in tests without reflecting the concrete type. |
| `filter(Boolean)` redundant | Low | `parts.filter(Boolean)` is unnecessary; each part is explicitly guarded before being added to the array. |
| `Plugin Context:` label hardcoded | Low | The label injected before plugin context is not configurable. If a consumer needs a different label or format, there is no override mechanism. |
| `schema` and `onToken` hardcoded | Low | Both `llm.chat()` parameters are hardcoded to `undefined`. Structured output and token streaming are not available to any `HeadlessAgent` consumer. |
| No observability beyond logging | Low | Unlike `BaseAgent`, `HeadlessAgent` emits no events. Plugin context failures, LLM calls, and fallback responses are all invisible without reading log output. |
