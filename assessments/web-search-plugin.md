# WebSearchPlugin Assessment

## Module Overview

WebSearchPlugin lets agents query the web using DuckDuckGo's instant-answer API. It sends a search query and parses the structured JSON response into four result categories: a direct answer, an abstract summary (from Wikipedia or other knowledge sources), related topic links, and direct web results. It exists to give agents fast, no-authentication-required access to factual lookups and current information without fetching full web pages.

It is a companion to WebReaderPlugin: WebSearchPlugin is used for discovery (what URLs are relevant?), and WebReaderPlugin is used for extraction (what does a specific page say?).

## Interface / Exports

```typescript
export class WebSearchPlugin implements AgentPlugin
```

**Constructor**

No constructor is defined; the default no-arg constructor is used.

**Implemented AgentPlugin hooks**

| Hook | Returns |
|---|---|
| `getSystemPromptFragment()` | Instructs the LLM to use `web_search` for facts, definitions, and internet information |
| `getTools()` | One tool definition: `web_search` |
| `executeTool(name, args)` | Delegates `web_search` to `this.search(args.query)` |

**Tool: `web_search`**

- **Parameter**: `query` (string, required) — the search query.
- **Returns**: A plain object containing any combination of `answer`, `abstract`, `related`, and `web_results` fields, or `{ message }` if no results were found.

## Configuration

- **No API key required**: DuckDuckGo's instant-answer endpoint is public.
- **No environment variables**.
- **No constructor options**.
- **`DDGS_URL` constant**: `"https://api.duckduckgo.com/"` — hardcoded module-level constant.
- **Network timeout**: 10 seconds (`AbortSignal.timeout(10_000)`).

## Data Flow

```
LLM calls web_search { query: "capital of France" }
  → executeTool("web_search", { query: "capital of France" })
    → search("capital of France")
      → build URL: https://api.duckduckgo.com/
          ?q=capital+of+France
          &format=json
          &no_redirect=1
          &no_html=1
          &skip_disambig=1
      → fetch(url, { headers: { "User-Agent": "2b-agent/1.0" }, signal: timeout(10s) })
      → if !res.ok → throw Error("DuckDuckGo returned <status>")
      → data = await res.json()
      → build results object:
          if data.Answer       → results.answer = data.Answer
          if data.AbstractText → results.abstract = { text, source, url }
          if data.RelatedTopics → results.related = first 5 with .Text
          if data.Results      → results.web_results = first 5
      → if results is empty → return { message: "No instant answer found..." }
      → return results
```

## Code Paths

### Happy path — answer found

1. `executeTool` receives `name === "web_search"` and calls `search(args.query)`.
2. The DuckDuckGo instant-answer URL is built with four fixed parameters: `format=json`, `no_redirect=1`, `no_html=1`, `skip_disambig=1`.
3. A debug log entry is written.
4. The fetch is made with a `"2b-agent/1.0"` User-Agent and a 10-second timeout.
5. The response JSON is parsed.
6. Each of the four result categories is checked independently and added to the result object if data is present:
   - `data.Answer` → `results.answer` (raw string, e.g., calculator results).
   - `data.AbstractText` → `results.abstract` with `text`, `source` (e.g., `"Wikipedia"`), and `url`.
   - `data.RelatedTopics` → filtered to items with a `.Text` field, limited to 5, mapped to `{ text, url }`.
   - `data.Results` → limited to 5, mapped to `{ title, url }`.
7. The accumulated object is returned. It may contain any subset of the four keys depending on what DuckDuckGo returned.

### No results found

If none of the four conditionals adds a key to `results`, `Object.keys(results).length === 0` is true and the function returns `{ message: "No instant answer found. Try a more specific query or rephrase your search." }`. This is a soft non-error path — the LLM receives a hint to rephrase.

### HTTP error

If `res.ok` is false, `search` throws `new Error("DuckDuckGo returned ${res.status}")`. This propagates through `executeTool` to `BaseAgent`'s error handler.

### Unknown tool name

`executeTool` returns `undefined` implicitly for names other than `"web_search"`.

## Helper Functions / Internals

### `private async search(query: string)`

The sole implementation method. Builds the request URL, fetches, parses, and maps results. Not exported.

The four DuckDuckGo query parameters have specific meanings:
- `format=json`: Returns JSON instead of HTML.
- `no_redirect=1`: Prevents DDG from redirecting to the first result for unambiguous searches.
- `no_html=1`: Strips HTML markup from result text fields.
- `skip_disambig=1`: Bypasses DDG's disambiguation pages, returning the top result directly.

## Error Handling

| Scenario | Handling |
|---|---|
| No results from DuckDuckGo | Returns `{ message }` — soft error, no throw |
| HTTP non-2xx from DuckDuckGo | Throws `Error("DuckDuckGo returned <status>")` |
| Network timeout (>10s) | `AbortSignal.timeout` rejects; propagates as throw |
| Unknown tool name | Returns `undefined` silently |

The response body is never read on HTTP errors — unlike TMDB, there is no attempt to extract an error message from the response body before throwing.

## Integration Context

WebSearchPlugin is registered in the **web sub-agent** (`src/agents/sub-agents/createWebAgent.ts`), alongside `WebReaderPlugin`, `WikipediaPlugin`, and `RSSPlugin`. The web agent is a `HeadlessAgent` with the persona "web research specialist."

The intended usage pattern: the LLM calls `web_search` first to get a set of relevant URLs, then calls `read_webpage` (from WebReaderPlugin) to extract the content of specific pages.

Call chain:

```
User → CortexAgent
  → SubAgentPlugin.executeTool("web_agent", { task })
    → HeadlessAgent.ask(task)
      → WebSearchPlugin.executeTool("web_search", { query })
```

No other module imports WebSearchPlugin.

## Observations / Notes

- **DuckDuckGo instant answers are limited**: The DDG instant-answer API is primarily designed for knowledge-panel style responses (Wikipedia abstracts, quick facts, calculations). For broad web search results, the `data.Results` array is often empty or sparse. The `data.RelatedTopics` field is more consistently populated but contains DDG-curated topic links, not organic search results. For open-ended research queries, results will frequently be empty, triggering the "No instant answer found" message.
- **No web crawling**: This plugin does not return a ranked list of web search results in the traditional sense. It is limited to DDG's structured instant-answer data. WebSearchPlugin + WebReaderPlugin together approximate a traditional "search then read" workflow, but the search step has lower recall than a full search engine.
- **`no_html=1` is set but RelatedTopics text may still contain markup**: The `no_html=1` parameter applies to DDG's internal rendering. In practice some snippet text in `RelatedTopics` may still contain HTML entities or simple tags depending on the query. The plugin does not sanitise text fields from RelatedTopics.
- **Result caps are low**: 5 related topics and 5 web results are returned. There is no pagination support. For queries that would benefit from seeing more results, the LLM must rephrase and re-query.
- **Consistent result shape is not guaranteed**: The returned object may have any combination of `answer`, `abstract`, `related`, and `web_results` keys. The LLM and any downstream processing must handle partial responses.
- **User-Agent is minimal**: `"2b-agent/1.0"` is sent rather than a browser string. DDG's public API does not require a specific User-Agent, so this is fine, but it clearly identifies the client as a bot.
- **`skip_disambig=1` can suppress useful disambiguation**: For searches involving ambiguous topics, skipping disambiguation means the top result is used directly, which may not be the intended one.
