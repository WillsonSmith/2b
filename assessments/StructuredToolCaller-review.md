# Assessment: StructuredToolCaller
**File:** src/providers/llm/StructuredToolCaller.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] Silent loop continuation on unknown `type` value (line 97): When `parsed.type` is neither `"message"` nor `"tool_call"`, the while loop falls through to the next iteration without appending anything to chat. The model will keep producing the same unknown type, effectively spinning to `MAX_ITERATIONS`. Add an `else` branch that appends an error message and `continue`s, or breaks.
- [x] Falsy `parsed.tool` falls through silently (line 71): The condition `parsed.type === "tool_call" && parsed.tool` is false when `tool` is missing, but no message is appended and no `continue` is issued — wasting an iteration. Add an explicit else branch to inform the model of the malformed response.
- [x] Unsafe `(chat as any).append(...)` with no null-check (lines 75, 92, 93): If the runtime `chat` object does not expose `append`, this throws an untyped runtime error with no useful context. The cast suppresses TypeScript entirely; use a typed helper or assert the capability once at function entry.

## Refactoring / Code Quality
- [x] `modelClient: any` parameter (line 33): Replace with a local interface (e.g., `interface ModelClient { respond(chat: ChatLike, opts: object): Promise<{ content: string }> }`) so the contract is explicit and type-checked.
- [x] `onToolCall` callback `args: any` (line 36): Change to `Record<string, unknown>` to match the codebase convention used in `ToolDefinition.implementation` and `AgentPlugin.executeTool`.
- [x] Schema constant allocated inside function (lines 38-48): The schema object never varies between calls. Hoist it to module scope as a `const` to avoid repeated object allocation.
- [x] Linear tool lookup inside loop (line 72): `tools.find(...)` is O(n) per iteration. Build a `Map<string, ToolDefinition>` before the loop starts to make lookups O(1).
- [x] No iteration/debug tracing: There is no way to observe which tools were called or how many iterations were consumed without attaching a `onToolCall` callback. Consider logging iteration count at `MAX_ITERATIONS` boundary.

## Security
- [ ] Tool args passed to implementation without schema validation (lines 83-85): `parsed.args` originates from LLM output and is passed directly to `tool.implementation` with no validation against the tool's declared `parameters` JSON Schema. A model producing malformed or adversarial args will reach plugin code unchecked. Validate `parsed.args` against `tool.parameters` before calling the implementation. **SKIPPED — would require adding a JSON Schema validation dependency (e.g., ajv). Flagged for a dedicated follow-up.**
- [x] Limit-reached sentinel is indistinguishable from model output (line 100): The string `"I reached my tool call limit for this response."` is returned as a normal string; callers have no programmatic way to detect this condition and handle it (e.g., log a warning, surface an error). Throw a named error or return a discriminated result instead.

## Performance
- [x] Schema object recreated per call (lines 38-48): Minor allocation cost, but hoisting to module scope is a clean win (also noted under Refactoring).
- [x] `tools.find(...)` per iteration (line 72): O(n) scan per tool-call iteration; use a pre-built `Map` (also noted under Refactoring).

## Consistency / Style Alignment
- [x] `any` types violate codebase convention (lines 33, 36): `Plugin.ts` uses `Record<string, unknown>` for open-ended objects. `modelClient` and the `onToolCall` `args` parameter should follow the same pattern.
- [x] Inconsistent error string formatting (lines 77, 87): `Tool error: "${parsed.tool}" not found or has no implementation.` vs `Tool error: "${parsed.tool}" failed to execute.` — capitalization and phrasing differ. Adopt a single format, e.g., `Tool "${name}" not found.` and `Tool "${name}" threw: <message>`.
- [x] Repeated `(chat as any).append(...)` pattern (lines 75, 92, 93): Three identical unsafe casts suggest either the `ChatLike` import type is incomplete or a small helper `appendToChat(chat, role, content)` should encapsulate the cast and validate once.

## Notes
- The module is the sole adapter enabling non-native-tool-call models to participate in the plugin tool ecosystem. Changes here affect all LMStudio-backed agents that rely on structured output.
- The `ChatLike` type from `@lmstudio/sdk` apparently does not include an `append` method, which is why all three chat mutations require `as any`. If the SDK exposes a more specific type (e.g., `Chat`), it should be used in the parameter signature instead of `ChatLike`.
- Reviewers of `LMStudioProvider.ts` and `BaseAgent.ts` should be aware that `callWithStructuredTools` now throws `ToolCallLimitError` (exported) instead of returning a sentinel string — callers must handle or propagate this error.
- The args schema-validation item was skipped to avoid introducing a new dependency without explicit approval.
