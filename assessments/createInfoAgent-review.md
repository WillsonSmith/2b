# Assessment: createInfoAgent
**File:** src/agents/sub-agents/createInfoAgent.ts
**Reviewed:** 2026-03-28
**Risk level:** Low

## Bug Fixes
- No issues found.

## Refactoring / Code Quality
- [x] **Empty constructor in NotesPlugin (cross-module observation):** `NotesPlugin` declares `constructor() {}` (line 24 of NotesPlugin.ts) — an empty explicit constructor that adds no value. This is outside the module under review but affects every instantiation site including line 10 of `createInfoAgent.ts`. Within this module there is nothing to change, but reviewers of `NotesPlugin.ts` should remove the no-op constructor.
- [x] **System prompt does not enumerate note management:** The system prompt at line 11 says "manage notes" but the other sibling factories (`createWebAgent`, `createSystemAgent`) list capabilities more explicitly. "manage notes" is vague compared to "Look up movies, weather conditions" which is already concrete. Consider expanding to "create, list, read, and delete notes" to match the specificity used elsewhere in the prompt.

## Security
- No issues found. The `TMDBPlugin` reads its API key from the environment (`TMDB_API_KEY`) and never exposes it in responses. `NotesPlugin` uses path-traversal protection via `safeNotePath`. `WeatherPlugin` uses no credentials.

## Performance
- No issues found. Plugin instantiation is synchronous and cheap. No I/O is performed at factory time.

## Consistency / Style Alignment
- [x] **Import order differs from sibling factories:** `createWebAgent.ts` and `createSystemAgent.ts` each import plugins in the order they appear in the plugin array passed to `HeadlessAgent`. `createInfoAgent.ts` follows the same convention (TMDBPlugin → WeatherPlugin → NotesPlugin matches the array on line 10), so this is consistent — no change needed for the import order itself. However, `createMediaAgent.ts` and `createSystemAgent.ts` use a single blank line separating the `HeadlessAgent` import from the `LLMProvider` import. `createInfoAgent.ts` also follows this pattern correctly.
- [x] **No issues found beyond the note above.** All four sub-agent factories use the same structural pattern: one named export function, one `new HeadlessAgent(...)` call, no default export. `createInfoAgent.ts` is fully consistent.

## Notes
- The module is a pure factory (13 lines) with no logic beyond wiring. The risk of bugs within this file is near zero; most risk is delegated to the plugins.
- `NotesPlugin` uses `unlinkSync` (Node.js `node:fs`) for deletion while using `Bun.file` / `Bun.write` for reads and writes. This is a minor inconsistency in `NotesPlugin` — reviewers of that module should consider `await Bun.file(path).unlink()` or the equivalent Bun API if one exists for consistency with the project's Bun-first convention (per CLAUDE.md: "Prefer `Bun.file` over `node:fs`'s readFile/writeFile"). This is not actionable within `createInfoAgent.ts` itself but should be tracked against `NotesPlugin.ts`.
- The `info_agent` is registered in `AgentFactory.ts` with `inactivityTimeoutMs: 15_000` and `absoluteTimeoutMs: 30_000`. These are the tightest timeouts across all sub-agents, which is appropriate given that TMDB and weather calls are fast HTTP API calls. The timeout choices are well-matched to the plugin set.
- `TMDBPlugin` constructor accepts an optional `apiKey` override (line 16 of TMDBPlugin.ts), but `createInfoAgent.ts` uses `new TMDBPlugin()` without passing one, relying on `process.env.TMDB_API_KEY`. This is the intended usage pattern and is consistent with how the plugin is designed.
