# Assessment: MinimalToolsPlugin
**File:** src/agents/AgentFactory.ts (lines 14–35 and line 112)
**Reviewed:** 2026-03-28
**Risk level:** Low

## Bug Fixes
- [x] `echo` tool `implementation` (line 31–33): the guard `typeof text === "string" ? text : String(text ?? "")` is correct but silently coerces non-string values rather than returning an error or schema-validation failure. Because `required: ["text"]` is set in the schema, any non-string value arriving here indicates the LLM violated the schema. A `console.warn` or structured log on the else-branch would make silent coercions observable during debugging.
- [x] `get_current_time` returns `new Date().toString()` (line 19), which formats the date using the system locale and timezone. If the runtime timezone is UTC (common in server/container environments) this will return a UTC time that may confuse users expecting local time. `new Date().toLocaleString()` with an explicit locale or `Intl.DateTimeFormat` would produce a more predictable output.

## Refactoring / Code Quality
- [x] The `minimalTools` array (lines 14–35) is a module-level constant, which is appropriate given the refactoring already applied in the current version. However, the inline plugin registration at line 112 (`{ name: "MinimalTools", getTools: () => minimalTools }`) is the only place in `AgentFactory.ts` that uses a plain object literal rather than a `new SomePlugin()` call. Extracting it to a named `const minimalToolsPlugin: AgentPlugin` above the factory function would make the registration line uniform with the other `agent.registerPlugin(...)` calls and would make the plugin name (`"MinimalTools"`) co-located with the tools array for easier maintenance.
- [x] `get_current_time` `parameters` schema (lines 18) sets `properties: {}` and `additionalProperties: false`, which is correct. However, `required` is absent. For an empty-parameter tool the absence of `required` is harmless, but explicitly adding `required: []` would be consistent with how other tools in the codebase declare their schemas.

## Security
No issues found.

## Performance
No issues found.

## Consistency / Style Alignment
- [x] The `echo` tool description (line 24–25) says "Useful for confirming what the agent heard." The description style elsewhere in the codebase (e.g. `get_current_time`: "Returns the current local date and time.") uses a plain present-tense sentence. The `echo` description appends a usage hint in a second sentence; trimming it to "Echoes the given text back." would match the single-sentence style used throughout.
- [x] `src/agents/CLAUDE.md` (the orchestrator diagram) still lists `MinimalToolsPlugin (calculate, get_current_time, echo)`. The `calculate` tool is not present in the current implementation (it was removed during a prior refactor). The diagram should be updated to `MinimalTools (get_current_time, echo)` to prevent confusion for future contributors.

## Notes
- `MinimalToolsPlugin` is not a file or class — it is an inline plain-object plugin (`{ name: "MinimalTools", getTools: () => minimalTools }`) registered in `createAgent()` at line 112 of `AgentFactory.ts`. The `minimalTools` array at lines 14–35 of the same file is its entire implementation. Any reviewer searching for a `MinimalToolsPlugin.ts` file will not find one; this should be documented in `src/agents/CLAUDE.md`.
- The `echo` tool's `implementation` accepts `unknown` (line 30), which is the correct pattern for `ToolDefinition.implementation`. Other tools in the broader plugin ecosystem that take typed arguments may want to follow this same pattern.
- `get_current_time` has no external dependencies and cannot fail. `echo` can only fail if `args` is `null` or `undefined`, which is guarded. Neither tool requires async handling, so the synchronous implementations are appropriate.
