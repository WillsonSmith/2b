# Assessment: WebSearchPlugin
**File:** src/plugins/WebSearchPlugin.ts
**Reviewed:** 2026-04-13
**Risk level:** Medium

## Bug Fixes
- [x] Unhandled fetch errors in `executeTool`: `executeTool` calls `this.search()` without a try/catch. If the fetch fails (non-2xx, network timeout, JSON parse error), the exception propagates out of `executeTool` uncaught. Either catch in `executeTool` and return `{ message: ... }`, or document that callers must handle it — but other `AgentPlugin` implementations likely expect a safe return value.
- [x] `web_results` title field is wrong: `rec.Text` in DuckDuckGo's `Results` array is an HTML-formatted snippet (the full result blurb), not a title. There is no plain `Title` field — the best available is the text content of `Text`. Consider stripping HTML tags or renaming the field to `snippet` to reflect what it actually contains.

## Refactoring / Code Quality
- [x] Unbounded cache growth: `this.cache` is a `Map` with no max-size cap and no periodic eviction. Stale entries are only removed on a cache-hit TTL check. Under sustained usage the cache grows indefinitely. Add a max-entries cap (e.g. 100) with LRU eviction or a `setInterval` flush.
- [x] `search` method is oversized (~75 lines): the response-shaping logic (lines building `answer`, `abstract`, `related`, `webResults`) could be extracted into a private `parseResponse(data)` helper to improve readability and testability.
- [x] Verbose conditional spread pattern: `...(answer !== undefined ? { answer } : {})` repeated three times. Direct conditional assignment (`if (answer) result.answer = answer`) is clearer and avoids allocating throwaway objects.

## Security
- [x] No issues found.

## Performance
- [x] Triple array traversal for `related`: `filter → slice → map` creates two intermediate arrays. A single `reduce` or `for` loop that collects up to 5 qualifying items would avoid the allocations, though at these small sizes the impact is negligible.

## Consistency / Style Alignment
- [x] No error logging on throw path: `logger.debug` is used for cache hits and searches, but the `throw new Error(...)` on non-ok responses has no accompanying `logger.error` or `logger.warn`. Other plugins in the codebase log before throwing — align with that pattern.
- [x] `SearchResult` fields use `snake_case` (`web_results`, `abstract`): TypeScript convention (and the rest of the plugin) uses camelCase. If `SearchResult` is only internal, rename to `webResults` etc. for consistency; if it's serialised to the LLM as-is, document that intentional choice.
- [x] Constant name `DDGS_URL` implies a search endpoint, but the URL is the DuckDuckGo Instant Answer API (`api.duckduckgo.com`), not the search results endpoint. Rename to `DDG_INSTANT_ANSWER_URL` to match the system-prompt description and avoid confusion.

## Notes
- The plugin's usefulness is limited by the DuckDuckGo Instant Answer API: it returns no results for most queries that aren't entity lookups or definitions, falling back to the "No instant answer found" message. This is a known limitation of the endpoint (not a bug), but worth flagging so callers don't rely on it for general web search.
- If real web search is needed in future, a `web_results` field populated from a proper search API (e.g. Brave Search, SerpAPI) would be a natural extension of the existing `SearchResult` shape.
