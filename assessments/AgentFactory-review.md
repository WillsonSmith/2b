# Assessment: AgentFactory
**File:** src/agents/AgentFactory.ts
**Reviewed:** 2026-03-28
**Risk level:** Low

## Bug Fixes
- [x] `echo` tool missing type guard on args (line 34): `implementation: ({ text }: { text: string }) => text` — if the LLM passes a non-string or omits the field, the cast silently returns `undefined`. Add a runtime guard: `implementation: (args: unknown) => { const text = (args as any)?.text; return typeof text === "string" ? text : String(text ?? ""); }`.
- [x] `get_current_time` `parameters` schema declares `properties: {}` but omits `additionalProperties: false` (line 22). Some LLM tool-call validators or strict JSON Schema consumers will treat this as an open schema and may pass unexpected args; the implementation ignores them harmlessly, but the schema should be explicit to match the intent.

## Refactoring / Code Quality
- [x] `MinimalToolsPlugin` is a private implementation detail that is only ever used in `createAgent()`. Moving it inside the module as a plain function that returns the tools array (and registering via a simpler inline plugin object) would reduce indirection. Alternatively, if it's kept as a class, it should be `const class` (declared in the same scope) rather than a module-level class to signal it's not exported.
- [x] The comment block on lines 56–60 (the `NOTE:` about context injection fragility) documents a known design limitation but would be more actionable as a `// TODO:` in the `SubAgentPlugin` where the structural fix would actually live. Leaving it in the system prompt assignment makes it easy to overlook.
- [x] `createAgent()` return type is inlined at the call site (lines 42–45). Defining a `CreateAgentResult` type alias or interface in this file would make the signature easier to read and extend.
- [x] `model` and `lmStudioUrl` are read from `process.env` with `??` fallbacks but are not validated (e.g. empty string `""` would pass the `??` check and be used verbatim). A one-line guard — `if (!model) throw new Error("MODEL env var is empty")` — would give a clearer failure mode than a downstream LMStudio connection error.

## Security
- [x] `process.env.LM_STUDIO_URL` is accepted without validation (line 47). A malformed or attacker-controlled value could redirect WebSocket connections to an unintended host. Validate the URL with `new URL(lmStudioUrl)` before passing it to `LMStudioProvider` and throw a descriptive error on failure.

## Performance
No issues found.

## Consistency / Style Alignment
- [x] All other sub-agent registrations (lines 76–105) pass explicit `inactivityTimeoutMs` and `absoluteTimeoutMs` except `media_agent` (lines 68–75), which intentionally omits them with a comment. The comment is appropriate, but adding a `// intentionally no timeout — see note` comment at the registration call site (inside the object literal) rather than as a trailing line comment would match the style of inline option comments used elsewhere in the codebase.
- [x] `process.env` is used directly (lines 46–47) in a module that otherwise delegates all external-system construction to factory arguments. Accepting `model` and `lmStudioUrl` as optional parameters with `process.env` fallbacks would align with the dependency-injection style used by sub-agent factories (all of which take an `LLMProvider` parameter).

## Notes
- `MinimalToolsPlugin` provides `get_current_time` and `echo`. The `calculate` tool mentioned in `src/agents/CLAUDE.md` under the orchestrator diagram (`MinimalToolsPlugin (calculate, get_current_time, echo)`) is **not present** in the current implementation. This is either stale documentation or a removed feature — the CLAUDE.md should be updated to match.
- `MemoryPlugin` (line 107) receives the `llm` provider directly. If `LMStudioProvider` were swapped out or made lazy, this coupling would require `AgentFactory.ts` changes. This is a cross-module concern worth noting for reviewers of `MemoryPlugin`.
- All four sub-agents share the same `LMStudioProvider` instance (`llm`). If `LMStudioProvider` holds per-conversation state (e.g. message history), sharing a single instance across independent `HeadlessAgent` instances could cause state bleed. This should be verified in `LMStudioProvider`.
