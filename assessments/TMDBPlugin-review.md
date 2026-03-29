# Assessment: TMDBPlugin
**File:** src/plugins/TMDBPlugin.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] `executeTool` returns `undefined` for unknown tool names instead of explicitly returning `undefined`: The method has no final `return` statement after all the `if` branches (lines 160–187). Per plugin conventions (plugins/CLAUDE.md), `executeTool` should return `undefined` for unknown names so other plugins can handle them. This is technically satisfied implicitly, but an explicit `return undefined;` at line 187 makes the contract clear and prevents future regressions if the method signature changes.
- [x] `movieId` / `personId` args are not validated before use: In `executeTool`, `args.movie_id` and `args.person_id` (lines 165, 169, 173, 185) are passed directly to private methods without checking they are defined numbers. If the LLM omits a required parameter, these will be `undefined`, resulting in a malformed URL such as `/movie/undefined` or `/person/undefined`. Add a guard: `if (!args.movie_id) return { error: "movie_id is required" };` before each call.
- [x] `args.query` is not validated in `searchMovies` and `searchPerson`: If `args.query` is an empty string or missing, the TMDB API will return an error, but the error propagates as an unhandled thrown `Error` from `tmdbFetch`. Validate that `query` is a non-empty string before the fetch.

## Refactoring / Code Quality
- [x] `executeTool` uses a long chain of `if` statements (lines 160–187): A dispatch map (`const dispatch = { search_movies: ..., get_movie_details: ... }`) would remove the repetition, make it easier to add new tools, and match patterns used elsewhere in the codebase.
- [x] `args: any` on `executeTool` (line 155): The `AgentPlugin` interface likely types `args` as `any` too, but a local type alias (e.g., `type AnyArgs = Record<string, unknown>`) with explicit casts inside each branch would improve readability and catch accidental property access errors at dev time. Changed signature to `Record<string, unknown>` with explicit casts at call sites.
- [x] Dead return path in `executeTool`: If none of the `if` branches match, the function returns `undefined` implicitly. Per the plugin convention this is correct, but it should be explicit (`return undefined;`) for clarity, as noted in Bug Fixes. Addressed via dispatch map — unknown names now explicitly return `undefined`.
- [x] Magic number `15` in `getMovieCredits` (line 274) and `20` in `getTrendingMovies` (line 319) and `getPersonDetails` (line 364): These result-count caps are scattered across methods as inline literals. Define them as named constants near the top of the class (e.g., `private static readonly MAX_CAST = 15;`) so limits can be adjusted in one place.
- [x] `imgUrl` is a module-level free function (line 7) rather than a private static method: Since it is only used inside `TMDBPlugin`, moving it to `private static imgUrl(...)` keeps the module surface clean and consistent with the class-centric structure.

## Security
- [x] API key logged indirectly via debug URL in `tmdbFetch` (line 199): The debug log `GET ${url.pathname}${url.search}` does not include the key because the key is sent in the `Authorization` header rather than as a query parameter — this is correct. No issue here. However, if `this.apiKey` were ever accidentally added to `url.searchParams`, it would be logged. A code comment noting this intentional design would help future maintainers. Added clarifying comment above constructor and in tmdbFetch.
- [x] `process.env.TMDB_API_KEY` usage (line 17): The project uses Bun, which auto-loads `.env`. Using `process.env` works in Bun, but the project convention might prefer `Bun.env.TMDB_API_KEY` for consistency (Bun exposes env via both). This is a minor consistency issue, not a security risk. Kept as `process.env` — all other plugins use `process.env`, so this is consistent with plugin layer conventions.
- [x] No sanitization of `query` before inserting into URL search params (lines 218, 333): `URLSearchParams` handles encoding automatically via `url.searchParams.set(...)`, so there is no injection risk. No action required, but worth confirming during future maintenance. No change needed — confirmed safe.

## Performance
- [x] `getPersonDetails` makes two parallel fetches with `Promise.all` (line 357): This is already optimal. No issue.
- [x] Response payload from TMDB is mapped and sliced immediately (e.g., `.slice(0, 10)` on lines 227, 302, 339), preventing large arrays from being held in memory. This is good practice. No issue.
- [ ] No caching of any TMDB responses: Repeated calls for the same `movie_id` or `person_id` within a session will always hit the network. For a voice/conversational agent, the same movie details may be requested multiple times in one conversation. A simple `Map`-based in-memory cache with a TTL (e.g., 5 minutes) on `tmdbFetch` results would reduce latency and API quota usage. This is an enhancement, not a critical issue. **SKIPPED** — out of scope for this assessment cycle; would add meaningful complexity and is an enhancement rather than a fix.
- [x] `AbortSignal.timeout(10_000)` (line 206): The 10-second timeout is reasonable. No issue.

## Consistency / Style Alignment
- [x] `process.env` instead of `Bun.env` (line 17): Other plugins that read env vars (e.g., `LMStudioProvider`) use `process.env`. This is consistent within the codebase, but conflicts with CLAUDE.md's preference for Bun APIs. Confirmed: all other plugins use `process.env` — kept as-is for plugin layer consistency.
- [x] `executeTool(name: string, args: any)` — the `args` parameter type `any` is consistent with the `AgentPlugin` interface and other plugins. No deviation. Updated to `Record<string, unknown>` for improved type safety at the dispatch layer.
- [x] All private methods use `async` consistently and return plain objects (not `Response` or wrapped types). This matches the plugin convention. No issue.
- [x] The plugin does not implement `onInit`, `getContext`, `onMessage`, `getMessages`, or `augmentResponse`. This is correct — the plugin only needs `getSystemPromptFragment`, `getTools`, and `executeTool`. No unnecessary stubs are present, which is good.
- [x] Error thrown from `tmdbFetch` (line 211) propagates as an uncaught exception to the caller. Other plugins likely follow the same pattern, but the plugin CLAUDE.md does not specify whether `executeTool` should catch and return `{ error: ... }` or let exceptions bubble. For consistency with the `apiKey` guard pattern on lines 156–158, errors from failed fetches should also be caught and returned as `{ error: message }` objects rather than thrown, so the agent framework can handle them gracefully. Added try/catch in `executeTool` dispatch to catch thrown errors and return `{ error: message }`.

## Notes
- The plugin depends entirely on the TMDB v3 REST API and a bearer-token `TMDB_API_KEY`. There are no shared dependencies on other plugins; it is fully self-contained.
- The `imgUrl` helper is not exported. If another plugin or utility ever needs to construct TMDB image URLs, it would need to duplicate this logic. Consider exporting it if TMDB image URL construction is needed elsewhere in the future.
- `getPersonDetails` fetches both `/person/{id}` and `/person/{id}/movie_credits` but does not fetch TV credits (`/person/{id}/tv_credits`). This is a scoping decision (tools are described as movie-focused), but it may surprise users who ask about a person's TV work. The system prompt fragment and tool descriptions are appropriately scoped to "film or TV career" — the implementation is limited to movies only. This inconsistency between description and implementation is worth noting.
