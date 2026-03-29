# Assessment: types
**File:** src/core/types.ts
**Reviewed:** 2026-03-26
**Risk level:** Medium

## Bug Fixes
- [ ] `toolCallingStrategy` literal union duplicated in `LMStudioProvider`: The `"native" | "structured_output"` union is redeclared verbatim in `src/providers/llm/LMStudioProvider.ts` (line 26) rather than imported from `types.ts`. If a third strategy is added to `AgentConfig.toolCallingStrategy`, the provider's local copy silently diverges and the TypeScript compiler will not catch mismatches at the `AgentConfig → LMStudioProvider` boundary. Fix: export a named alias (e.g. `export type ToolCallingStrategy = "native" | "structured_output"`) from `types.ts` and import it in `LMStudioProvider.ts`.
- [ ] `Message.role` permits `"system"` but the first-element convention is undocumented: `BaseAgent` and `HeadlessAgent` treat system messages as a first-entry-only convention. There is no runtime guard or JSDoc communicating this constraint, making it easy for a new consumer to insert a `"system"` role mid-conversation and produce malformed LLM requests.

## Refactoring / Code Quality
- [ ] `AgentEventMap.interrupt` typed as empty tuple `[]`: This is valid TypeScript but communicates "no payload" ambiguously. A JSDoc comment (`/** No payload — signals the agent to abort its current inference. */`) would prevent future contributors from accidentally adding arguments.
- [ ] `AgentConfig.cortexName` has no documentation: The field is used in `CortexAgent` (line 25) as the unique key for the persistent memory store. Colliding `cortexName` values across agent instances cause memory cross-contamination. Add a JSDoc explaining uniqueness requirements and that it defaults to `config.name ?? "cortex"`.
- [ ] `AgentConfig.historyLimit` has no documented zero semantics: `MemoryPlugin` treats `0` (and `undefined`) as "unlimited" via a `> 0` guard (line 57), but the field type is plain `number` with no constraint documented. Add `/** Number of recent messages to pass to the LLM. 0 or omitted = unlimited. */`.
- [ ] `AgentConfig.heartbeatInterval` has no documented unit: `BaseAgent` interprets it as milliseconds (`heartbeatInterval ?? 3000`, line 129). Without a unit annotation consumers may supply seconds instead. Add `/** Milliseconds between heartbeat ticks. Defaults to 3000. */`.

## Security
- [ ] No issues found. This module contains only type declarations; it performs no I/O, accepts no runtime input, and holds no secrets.

## Performance
- [ ] No issues found. Pure type declarations have no runtime cost.

## Consistency / Style Alignment
- [ ] Mixed declaration styles: `AgentEventMap` and `AgentConfig` use `interface`, while `Message` uses `type`. Both are valid TypeScript, but inconsistency adds cognitive friction. Settle on `interface` for all top-level public contract object shapes, which also allows declaration merging if needed.

## Notes
- This file is the single source of truth for core agent contracts. Any change here has broad blast radius — `BaseAgent`, `CortexAgent`, `HeadlessAgent`, `MemoryPlugin`, `LMStudioProvider`, `LLMProvider`, and `AgentFactory` all depend on these types.
- The most actionable cross-module finding is the duplicated literal union in `LMStudioProvider.ts` (line 26). Reviewers of that file should address the import; the fix requires a companion named export from this file.
- `MemoryProvider.ts` (line 32) returns `{ role: string; content: string }[]` instead of `Message[]`. If `Message` grows additional required fields, `MemoryProvider` will silently drift out of contract.
