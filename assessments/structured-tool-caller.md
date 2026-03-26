# Assessment: StructuredToolCaller

**Files covered by this assessment:**

- `src/providers/llm/StructuredToolCaller.ts` — primary subject
- `src/providers/llm/LMStudioProvider.ts` — sole caller and integration context
- `src/providers/llm/LLMProvider.ts` — `LLMProvider` and `ChatResponse` interfaces
- `src/core/Plugin.ts` — `ToolDefinition` and `AgentPlugin` interfaces
- `src/core/types.ts` — `Message`, `AgentConfig` types

---

## Step 1 — Interface Contract

`StructuredToolCaller.ts` is not a class and does not implement a formal interface. It exports two standalone functions:

- `buildToolSystemPromptAddition(tools: ToolDefinition[]): string` — builds a text block that is injected into the system prompt to instruct a model on how to use tools via structured JSON output.
- `callWithStructuredTools(modelClient: any, chat: ChatLike, tools: ToolDefinition[], onToolCall?): Promise<string>` — drives a manual tool-call loop, returning the final text response.

Neither function appears in any interface definition. They are implementation-private utilities consumed only by `LMStudioProvider`. The module does not export a type describing the shape of `modelClient`, leaving that parameter entirely unconstrained at the call site (see Step 4).

`ToolDefinition` (from `src/core/Plugin.ts:4-9`) provides the data contract for each tool:

```ts
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any; // JSON Schema
  implementation?: (args: any) => any | Promise<any>;
}
```

Both `parameters` and `implementation` carry `any` types, which weakens the contract throughout the whole structured-tool pipeline. `implementation` is also optional, meaning the absence of an implementation is a valid `ToolDefinition` — a design tension `callWithStructuredTools` must defensively handle (and does, at line 74).

---

## Step 2 — Module-Level Configuration

A single module-level constant `MAX_ITERATIONS = 10` (line 4) governs the loop ceiling in `callWithStructuredTools`. It is:

- Not configurable at call time — callers cannot pass a different limit.
- Not exposed in any interface or config type.
- Silently reached — when it expires the function returns a hardcoded string (`"I reached my tool call limit for this response."`) rather than throwing or returning a typed sentinel, so callers cannot distinguish exhaustion from a genuine model response.

---

## Step 3 — `buildToolSystemPromptAddition` Entry Point

`buildToolSystemPromptAddition` maps each `ToolDefinition` to a human-readable bullet, then wraps the list in an instruction block. The format dictates that the model must respond with exactly one of two JSON shapes:

```json
{"type": "tool_call", "tool": "<name>", "args": {}}
{"type": "message", "content": "<text>"}
```

Key observations:

- `t.parameters` is serialised with `JSON.stringify(t.parameters, null, 2)`. Because `parameters` is typed `any` in `ToolDefinition`, passing a non-serialisable value (e.g. a function reference, a circular object) would produce `undefined` or throw at runtime.
- The format block uses template-literal JSON with unescaped angle brackets (`<tool_name>`, `<arguments>`). A tool whose name contains characters that a particular model tokenises unusually could confuse the prompt.
- There is no validation that the `tools` array is non-empty before building the string. An empty array produces a valid prompt with the header and `Available tools:` followed by a blank line, which could lead a model to believe there are tools when in fact there are none.

---

## Step 4 — `callWithStructuredTools` Primary Execution Path

The function signature is:

```ts
export async function callWithStructuredTools(
  modelClient: any,
  chat: ChatLike,
  tools: ToolDefinition[],
  onToolCall?: (name: string, args: any, result: string) => void,
): Promise<string>
```

`modelClient` is typed `any`. This completely removes type safety for the SDK call `modelClient.respond(...)` at line 55. A wrong object being passed will fail at runtime with no TypeScript warning. In `LMStudioProvider.ts` the concrete type is `LLMDynamicHandle` — that type should be used here.

The top-level flow is:

1. Define a JSON schema for the constrained response.
2. Loop up to `MAX_ITERATIONS` times.
3. On each iteration, call `modelClient.respond(chat, { structured: ... })`.
4. Parse the response.
5. If `type === "message"`, return `content`.
6. If `type === "tool_call"`, execute the tool and append the result to `chat`, then continue.
7. If the loop exhausts, return the limit-reached string.

---

## Step 5 — JSON Schema Definition

The response schema (lines 38–48) is defined inline on every call. It specifies:

```ts
{
  type: "object",
  properties: {
    type: { type: "string", enum: ["tool_call", "message"] },
    tool: { type: "string" },
    args: { type: "object", additionalProperties: true },
    content: { type: "string" },
  },
  required: ["type"],
  additionalProperties: false,
}
```

Issues:

- Only `type` is required. The schema permits a `{"type": "tool_call"}` response that omits `tool` and `args`, which the code at line 71 partially handles by checking `parsed.tool` — but `parsed.args` is accessed as `parsed.args ?? {}` without knowing whether it matches the tool's parameter schema.
- `args` is typed `{ type: "object", additionalProperties: true }` — the schema imposes no validation of argument names or types against the specific tool being called. A hallucinated argument name will pass through silently.
- The schema could be tightened per-call to enumerate valid tool names in `tool`'s `enum`, and to include conditional validation of `args` per tool. Currently the schema is the same for all tools on all iterations.

---

## Step 6 — JSON Parse Branch (Lines 60–65)

```ts
try {
  parsed = JSON.parse(response.content);
} catch {
  return response.content;
}
```

If the model produces malformed JSON despite the constrained-output mode, the raw `response.content` is returned directly as the final answer. This is a reasonable fallback, but it is silent — there is no log, no indication to the caller that the response bypassed the tool loop. A model that repeatedly produces unparseable output will silently return raw text every time, and `onToolCall` will never fire.

The `catch` clause swallows the parse error entirely. At minimum a debug log would help diagnose models that misbehave under structured output.

---

## Step 7 — `type === "message"` Branch (Lines 67–69)

```ts
if (parsed.type === "message") {
  return parsed.content ?? "";
}
```

If the model returns `{"type": "message"}` with no `content` field — which the schema permits — the function returns an empty string `""`. The caller (`LMStudioProvider.ts:99–104`) receives this as a valid `ChatResponse` with `response: ""`, `nonReasoningContent: ""`. There is no indication that the model gave an empty response rather than a normal one.

---

## Step 8 — Tool Execution Branch (Lines 71–97)

When `parsed.type === "tool_call"` and `parsed.tool` is present:

**Tool not found (lines 74–79):** If the tool name does not match any registered tool, the error is appended back to `chat` as a user message and the loop continues. This is a reasonable recovery — the model gets a chance to correct itself — but it counts against `MAX_ITERATIONS`. A model that persistently hallucinates a tool name can consume the entire iteration budget with error-recovery turns.

**Tool execution (lines 82–88):** The tool's `implementation` is called with `parsed.args ?? {}`. Errors are caught and converted to a string: `"Tool error: \"<name>\" failed to execute."` This message is passed to `onToolCall` and injected into `chat`, but the original exception is discarded. The caller and any observability layer have no access to the actual error.

**History append (lines 92–96):** The tool call and result are appended to `chat` via `(chat as any).append(...)`. The `chat` parameter is typed `ChatLike` from the SDK, but `append` is called using an `as any` cast on both lines. If the SDK changes the `Chat` API, this breaks silently at runtime.

**`onToolCall` order (line 90):** The callback fires after tool execution succeeds (or fails with the masked error) but before the loop continuation. This is reasonable, but the callback receives `args: any`, losing any type information about what the tool actually consumed.

---

## Step 9 — Iteration Exhaustion (Lines 98–100)

When `iterations` reaches `MAX_ITERATIONS` without returning, the function returns the string `"I reached my tool call limit for this response."`. This string is indistinguishable from a normal model response to the caller. `LMStudioProvider.ts` wraps it directly in `ChatResponse.response`. There is no thrown error, no sentinel value, and no log entry. The agent will speak this string to the user as if it were a genuine answer.

---

## Step 10 — Integration Context in `LMStudioProvider`

`callWithStructuredTools` is called at `LMStudioProvider.ts:99`. The `onToolCall` callback is not passed — `callWithStructuredTools` is called with only three arguments, so all tool executions go unobserved by the provider. By contrast, the native tool path (`actWithTools`) uses `logger.info` and `logger.debug` for every tool invocation and result. The structured-output path logs nothing about individual tool calls.

The `chat` object passed to `callWithStructuredTools` is the same `ChatLike` constructed in `LMStudioProvider.chat()` (line 73). The function mutates this object by appending messages during the loop. Because `chat` is a local variable in `LMStudioProvider.chat()`, there is no risk of cross-request state leakage, but the mutation is implicit and undocumented.

When `toolCallingStrategy === "structured_output"` is active, the `onToken` callback passed to `LMStudioProvider.chat()` is never forwarded to `callWithStructuredTools`. Streaming token-by-token output to the caller is therefore impossible for this code path — the full response is buffered internally and returned as a single string. This is an undocumented capability difference between the two strategies.

---

## Step 11 — Error Handling and Visibility

The module has several silent failure modes:

1. **JSON parse failure** — returns raw content without logging.
2. **Tool execution failure** — discards the original exception, injects a generic error string.
3. **Iteration exhaustion** — returns a human-readable string rather than throwing or signalling a typed error.
4. **Empty `content` on message response** — returns `""` with no indication.
5. **`(chat as any).append`** — type-cast bypasses SDK type checking; a breaking SDK change would be invisible at compile time.

None of these paths write to the `logger` that is imported and used throughout `LMStudioProvider.ts`. A developer debugging a structured-output run gets no log signal from within the tool loop.

---

## Summary Table

| Area | Severity | Issue |
|---|---|---|
| `callWithStructuredTools` signature | High | `modelClient` typed `any`; no compile-time safety for SDK calls |
| Iteration exhaustion | High | Returns a human-readable string indistinguishable from a model response; callers cannot detect the limit was hit |
| Tool execution error | High | Original exception is discarded; callers and logs receive only a generic error string |
| JSON parse failure | Medium | Raw content returned without any log entry; repeated malformed output is invisible to operators |
| `onToolCall` not forwarded | Medium | `LMStudioProvider` passes no callback, so structured-output tool calls are entirely unlogged compared to the native path |
| `onToken` not forwarded | Medium | Streaming is silently disabled for `structured_output` strategy; undocumented capability gap |
| `(chat as any).append` | Medium | `as any` cast bypasses SDK type safety on both history-append calls |
| Empty `content` on `message` response | Medium | Returns `""` with no indication; caller cannot distinguish deliberate empty response from a schema omission |
| JSON schema — only `type` required | Medium | Schema permits `{"type": "tool_call"}` without `tool` or `args`; partial handling exists but the gap is not enforced |
| `MAX_ITERATIONS` not configurable | Low | Hard-coded at module level; callers cannot adjust the limit per agent or per request |
| `buildToolSystemPromptAddition` — empty tools array | Low | Renders a prompt claiming tools are available even when the list is empty |
| `buildToolSystemPromptAddition` — `parameters: any` | Low | Non-serialisable `parameters` values would produce `undefined` output silently |
| JSON schema — no per-tool `args` validation | Low | `args` schema is generic for all tools on all iterations; hallucinated argument names pass through |
| No logging inside the tool loop | Low | Unlike the native path, structured-output tool calls produce no `logger` output, reducing observability |
