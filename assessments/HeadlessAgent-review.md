# Assessment: HeadlessAgent
**File:** src/core/HeadlessAgent.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] **Mutating shared tool objects (line 59):** `t.implementation` is assigned directly on objects returned by `plugin.getTools()`. If a plugin returns the same `ToolDefinition` object references each call (e.g. a cached array), repeated calls to `ask()` will overwrite the implementation on the shared object. Use a shallow clone: `const t = { ...rawTool }` before assigning `t.implementation`.

## Refactoring / Code Quality
- [x] **Two separate loops over `this.plugins` (lines 27–30 and 53–67):** Fragments and tools are both gathered from plugins in distinct loops. These could be merged into a single pass to reduce redundant iteration. Note: the `getContext` loop must remain separate as it is `async`.
- [x] **`any` on `toolCallHandler` and `ToolDefinition.implementation` args:** Line 12 (`args: any`) and the closure at line 59 (`(args) =>`) rely on `any`. Consider narrowing to `Record<string, unknown>` to match the `executeTool` signature already defined on `AgentPlugin` (Plugin.ts line 22).
- [x] **`parts.filter(Boolean)` with typed array (line 49):** `parts` is `string[]`, so no element will ever be falsy in a way that `filter(Boolean)` would remove — `systemPromptBase` could be an empty string and still pass through. Replace with an explicit `parts.filter(p => p.trim().length > 0)` to make intent clear and handle blank base prompts.

## Security
- [x] **Task string injected into system prompt via plugin context (line 38):** `plugin.getContext([task])` feeds raw user-controlled input into the system prompt construction. If a plugin reflects the task string back into the context without sanitisation, prompt injection is possible. This is a design-level concern — add a note in the JSDoc that plugin `getContext` implementations must not echo back untrusted input verbatim.

## Performance
- No issues found.

## Consistency / Style Alignment
- [x] **Unused `undefined` arguments in `llm.chat` call (lines 75, 77):** Two `undefined` positional arguments are passed explicitly. Check whether `LLMProvider.chat` supports optional trailing parameters; if so, omit these to match the calling style used elsewhere in the codebase.
- [x] **`toolCallHandler` invoked but result discarded (line 60):** The handler is a side-effect callback with no return value enforced (`void`), yet it is called inside a function that returns `plugin.executeTool!(...)`. This is fine functionally but the intent (observe vs. intercept) is not documented. Add a brief inline comment clarifying it is observation-only.

## Notes
- The class comment (line 7–10) correctly documents that `onMessage`, `getMessages`, and `augmentResponse` are not invoked, but does not mention `onInit`. If `onInit` is expected to have been called before `ask()`, that assumption should be stated so callers know to initialise plugins before constructing `HeadlessAgent` with them.
- The mutation bug noted in Bug Fixes is the most likely source of hard-to-reproduce cross-call contamination if tools with `implementation` pre-set are later re-wrapped incorrectly.
