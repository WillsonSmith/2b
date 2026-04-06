# Assessment: MetacognitionPlugin
**File:** src/plugins/MetacognitionPlugin.ts
**Reviewed:** 2026-04-06
**Risk level:** Medium

## Bug Fixes

- [x] **Stale-prune dead code** (L862-863, L892-895): `STALE_TURNS = EFFECTIVE_TURNS * 3 = 30`, but `TURN_HISTORY_LIMIT = 20`. `turnHistory` can hold at most 20 turns, so `turnsSince.length` in the stale-prune branch (`correction.effectiveness === "effective"`) can never reach 30. The `if (turnsSince >= STALE_TURNS)` predicate at L895 is permanently false — effective corrections are never pruned. Fix: either raise `TURN_HISTORY_LIMIT` to ≥ 30, or lower `STALE_TURNS` to be within the history window (e.g. `EFFECTIVE_TURNS * 2 = 20`).

- [x] **`deleteMemory().catch()` on a sync return value** (L121): `this.memoryPlugin.db.deleteMemory(mem.id).catch(() => {})` — if `deleteMemory` returns `void` (as SQLite operations in `bun:sqlite` typically do), calling `.catch()` on it throws `TypeError: undefined is not a function`. The surrounding `try/catch` at L136 will catch it, but it adds unnecessary noise. Fix: drop `.catch(() => {})` and let the outer `try/catch` handle errors, or `await` it if it truly returns a Promise.

- [x] **Unguarded `JSON.stringify` in `tool_call` event handler** (L143-144): `JSON.stringify(args).slice(0, 100)` inside the event handler registered in `onInit` is not wrapped in try/catch. A circular reference in `args` throws `TypeError: Converting circular structure to JSON`, which propagates as an uncaught error from the event emitter. Fix: wrap in `try { JSON.stringify(args) } catch { return "[unserializable]" }` or use a safe serializer.

- [x] **`turnHistory` misses turns with no tool calls, breaking `hedged_no_search` detection** (L328): Turns are only archived when `tool_calls.length > 0`. The `hedged_no_search` pattern requires `memory_access_count === 0`, which is always true for turns with zero tool calls — yet those turns are never archived and therefore invisible to `patternRecurredIn`. In practice, pure-inference turns (no tools, still hedging) are never counted. This is arguably intentional, but if the agent consistently hedges on tool-free turns, the pattern will never fire. Clarify intent with a comment; if unintentional, archive turns with uncertainty markers even when `tool_calls` is empty.

## Refactoring / Code Quality

- [x] **`handleEfficiencyReport` is 207 lines** (L454-661): The method covers current-turn analysis, historical analysis, correction effectiveness, and suggestions as one monolithic function. Extract into `buildCurrentTurnSection()`, `buildHistoricalSection()`, `buildCorrectionSection()`, and `buildSuggestionsSection()` private helpers to match the logical sections already delimited by comments.

- [x] **Duplicated `counts` aggregation block** (L582-588, L698-704): Identical `{ pending, effective, ineffective, effective_after_strengthen, failed }` counting logic appears in both `handleEfficiencyReport` and `handleShowCorrections`. Extract to a private `aggregateCorrectionCounts()` method.

- [x] **Duplicated redundancy-detection logic** (L566-573, L751-759): The inner-loop pattern that detects whether a turn had a duplicate tool call (seen `Set`, `tool:args_summary` key) appears verbatim in both `handleEfficiencyReport` and `maybeAutoCorrect`. Extract to a private `turnHasRedundancy(turn: TurnState): boolean` helper.

- [x] **`executeTool` dispatch chain** (L304-322): Eight sequential `if (name === ...)` checks. A `const handlers: Record<string, () => unknown>` map initialized in `getTools()` or a switch would reduce the dispatch surface and make it harder to forget to wire up a new tool.

## Security

- [x] **`args_summary` may capture sensitive values** (L143-144): Tool arguments are serialized to a 100-char string and stored in `turnHistory` for the life of the session. If a plugin tool receives passwords, tokens, or PII as arguments, they will persist in memory until the turn is evicted. This is an in-process concern, but worth noting if `turnHistory` is ever serialized or logged externally. Mitigation: redact keys that match known sensitive patterns (e.g. `password`, `token`, `key`, `secret`) before storing.

- [x] **`get_system_prompt` tool exposes full assembled prompt** (L686-692): `handleGetSystemPrompt` returns the entire system prompt, which may contain injected behavior rules, correction text, or other internal state. The tool is callable only by the agent itself, not by external callers, so risk is low — but if a future plugin injects secrets into the system prompt fragment, this tool would expose them. Add a note in the tool description warning that the output may contain sensitive behavioral rules.

## Performance

- [x] **Repeated `turnHistory.filter` per correction in `checkCorrectionEffectiveness`** (L869-871, L892-894): For each correction in `correctionHistory` (up to 50), `this.turnHistory.filter(...)` is called independently. With `CORRECTION_HISTORY_LIMIT = 50` and `TURN_HISTORY_LIMIT = 20`, this is O(50 × 20) = 1000 comparisons per assistant message. Currently negligible, but if limits grow the cost scales quadratically. A single pass to compute `turnsSinceByDate` keyed on correction `applied_at` would eliminate the redundancy.

## Consistency / Style Alignment

- [x] **`console.warn` in `executeTool`** (L320): CLAUDE.md plugin convention states "Use `../logger.ts` for logging — never `console.log` except for fatal errors." The `console.warn` call at L320 should be `logger.warn("MetacognitionPlugin", ...)` to match the pattern used in `strengthenCorrectiveRule` (L970).

- [ ] **Stale documentation: default threshold** *(skipped — modifying src/plugins/CLAUDE.md is outside target module scope per update-module rules)* (`src/plugins/CLAUDE.md`): The plugin catalog still documents the saturation threshold as "default 5", but the constructor comment at L66-68 notes it was raised to 8. Update the CLAUDE.md entry to reflect the current default.

## Notes

- The stale-prune bug (first Bug Fix item) means effective corrections accumulate indefinitely in-memory and in the DB. Over a long session with many patterns, `correctionHistory` could grow toward `CORRECTION_HISTORY_LIMIT = 50` without natural cleanup. The `shift()` at L828 will eventually evict old records, but the DB entries they reference will never be deleted. This is a slow memory leak in the behavior table.
- `maybeAutoCorrect` is triggered after every assistant message (L361) and internally calls `checkCorrectionEffectiveness`, which does DB queries. In a high-frequency agent session, this could add noticeable latency. Consider debouncing to every N turns via a turn counter.
- Cross-module dependency: `MetacognitionPlugin` calls `this.memoryPlugin.executeTool!("delete_memory", ...)` at L927 and L954 using the non-null assertion on `executeTool`. If `CortexMemoryPlugin` ever changes `executeTool` to `undefined` for unknown names (per plugin convention), these calls become silent no-ops rather than deletions. Prefer calling `this.memoryPlugin.db.deleteMemory(id)` directly.
