# WikipediaPlugin Assessment

## Module Overview

WikipediaPlugin gives agents structured access to English Wikipedia. It exposes two tools: a search tool that finds articles by keyword using the MediaWiki API, and an article-fetch tool that retrieves the summary and introduction of a specific article using the Wikipedia REST API. It exists as a high-quality, structured encyclopedic knowledge source — more authoritative and better-structured than a DuckDuckGo instant answer, but more focused than open web reading.

The two-tool design mirrors a natural research pattern: first search to find the correct article title, then fetch to read the introduction.

## Interface / Exports

```typescript
export class WikipediaPlugin implements AgentPlugin
```

**Constructor**

No constructor is defined; the default no-arg constructor is used.

**Implemented AgentPlugin hooks**

| Hook | Returns |
|---|---|
| `getSystemPromptFragment()` | Tells the LLM to use `wikipedia_search` first, then `wikipedia_get_article` with the exact title from the search results |
| `getTools()` | Two tool definitions: `wikipedia_search` and `wikipedia_get_article` |
| `executeTool(name, args)` | Dispatches to `search` or `getArticle`; warns and returns `undefined` for unknown tool names |

**Tool: `wikipedia_search`**

- **Parameters**: `query` (string, required), `limit` (number, optional, default 5, max 10).
- **Returns**: Array of `{ title, snippet, wordcount }` objects.

**Tool: `wikipedia_get_article`**

- **Parameters**: `title` (string, required) — the exact article title as returned by `wikipedia_search`.
- **Returns**: `{ title, description, extract, url }` on success, or `{ error }` on 404.

## Configuration

- **No API key required**: Both Wikipedia APIs are public.
- **No environment variables**.
- **No constructor options**.
- **`API_BASE` constant**: `"https://en.wikipedia.org/w/api.php"` — MediaWiki Action API endpoint.
- **`REST_BASE` constant**: `"https://en.wikipedia.org/api/rest_v1"` — Wikipedia REST API endpoint.
- **No explicit timeouts**: Unlike other plugins, this plugin does not set `AbortSignal.timeout`. Requests can hang indefinitely.
- **User-Agent**: `"2b-agent/1.0 (https://github.com/WillsonSmith/2b)"` — Wikimedia's bot policy requires a descriptive User-Agent with contact information; this satisfies that requirement.

## Data Flow

### Search flow

```
LLM calls wikipedia_search { query: "quantum entanglement", limit: 3 }
  → executeTool("wikipedia_search", { query, limit })
    → search("quantum entanglement", 3)
      → clamp limit to [1, 10] → 3
      → build URLSearchParams:
          action=query, list=search, srsearch=quantum+entanglement,
          srlimit=3, format=json, origin=*
      → fetch("https://en.wikipedia.org/w/api.php?...", { User-Agent header })
      → if !res.ok → throw Error("Wikipedia search failed: <status> <statusText>")
      → data = await res.json()
      → results = data.query.search ?? []
      → return results.map(r => ({
          title: r.title,
          snippet: r.snippet.replace(/<[^>]+>/g, ""),   // strip HTML tags
          wordcount: r.wordcount,
        }))
```

### Article fetch flow

```
LLM calls wikipedia_get_article { title: "Quantum entanglement" }
  → executeTool("wikipedia_get_article", { title })
    → getArticle("Quantum entanglement")
      → encodedTitle = encodeURIComponent("Quantum_entanglement")
      → fetch("https://en.wikipedia.org/api/rest_v1/page/summary/Quantum_entanglement",
              { User-Agent header })
      → if res.status === 404 → return { error: 'Article not found: "...". Try searching first.' }
      → if !res.ok → throw Error("Wikipedia fetch failed: <status> <statusText>")
      → data = await res.json()
      → return {
          title: data.title,
          description: data.description,
          extract: data.extract,
          url: data.content_urls?.desktop?.page,
        }
```

## Code Paths

### `search` — happy path

1. `limit` is clamped: `Math.min(Math.max(1, limit ?? 5), 10)`. Default is 5; max is 10.
2. URLSearchParams are built with `origin=*` (required for CORS, harmless server-side).
3. The MediaWiki Action API is queried via `?action=query&list=search`.
4. HTML tags are stripped from `snippet` fields using a regex `/<[^>]+>/g` — the MediaWiki API returns `<span class="searchmatch">` highlight spans in snippets.
5. An array of clean objects is returned.

### `search` — HTTP error

If `res.ok` is false, throws `Error("Wikipedia search failed: ${res.status} ${res.statusText}")`. The response body is not read.

### `getArticle` — happy path

1. Spaces in the title are replaced with underscores before `encodeURIComponent` — Wikipedia REST API expects underscore-separated titles.
2. The REST `/page/summary/{title}` endpoint returns the article's short description and the `extract` (first few paragraphs of the introduction).
3. The desktop URL is extracted from the nested `content_urls.desktop.page` path.

### `getArticle` — 404

A 404 status is handled as a soft error: `{ error: 'Article not found: "...". Try searching first.' }` is returned without throwing. This guides the LLM to use `wikipedia_search` first before attempting `wikipedia_get_article`.

### `getArticle` — other HTTP errors

Non-2xx responses other than 404 throw `Error("Wikipedia fetch failed: ${res.status} ${res.statusText}")`.

### `executeTool` — unknown tool name

Calls `logger.warn("[WikipediaPlugin] unknown tool: ${name}")` and returns `undefined`. Unlike TimePlugin, it does not throw, but unlike most other plugins it does log a warning.

## Helper Functions / Internals

No private helper methods. Both `search` and `getArticle` are private methods of the class, each handling a single API interaction.

## Error Handling

| Scenario | Handling |
|---|---|
| Article not found (404) | Returns `{ error }` — soft error, no throw |
| HTTP non-2xx on search | Throws `Error("Wikipedia search failed: ...")` |
| HTTP non-2xx on article (not 404) | Throws `Error("Wikipedia fetch failed: ...")` |
| Network hang | No timeout set; request can hang indefinitely |
| Unknown tool name | `logger.warn(...)`, returns `undefined` |
| `data.query.search` missing | Falls back to `[]` via `?? []` |
| `content_urls?.desktop?.page` missing | Returns `undefined` for the `url` field |

## Integration Context

WikipediaPlugin is registered in the **web sub-agent** (`src/agents/sub-agents/createWebAgent.ts`), alongside `WebSearchPlugin`, `WebReaderPlugin`, and `RSSPlugin`. The web agent is a `HeadlessAgent` with the persona "web research specialist."

The intended workflow within the web agent: the LLM may use `wikipedia_search` to find an article title, then `wikipedia_get_article` to read it. Alternatively, if the LLM already knows the exact article title, it can call `wikipedia_get_article` directly and handle a 404 by falling back to search.

Call chain:

```
User → CortexAgent
  → SubAgentPlugin.executeTool("web_agent", { task })
    → HeadlessAgent.ask(task)
      → WikipediaPlugin.executeTool("wikipedia_search" | "wikipedia_get_article", args)
```

No other module imports WikipediaPlugin.

## Observations / Notes

- **No request timeout**: Both `search` and `getArticle` calls omit `AbortSignal.timeout`. Every other networked plugin in this codebase sets a 10–15 second timeout. If Wikipedia is slow or unreachable, these calls will hang until the Node/Bun default socket timeout fires (which may be minutes).
- **Naming inconsistency**: The class property is `name = "WikipediaPlugin"` (with the "Plugin" suffix), while all other plugins use just the domain name (e.g., `"WebSearch"`, `"TMDB"`, `"Weather"`). This means the `BaseAgent` logs and system prompt context block will show `"WikipediaPlugin"` while others show clean names. This is cosmetic but inconsistent.
- **Logging format is inconsistent**: Log calls use `logger.debug("[WikipediaPlugin] ...")` with bracket-prefixed strings as a single argument, while other plugins use the two-argument form `logger.debug("WikipediaPlugin", "...")`. This matters if the logger differentiates the first argument as a structured label.
- **`origin=*`**: The CORS parameter is harmless in a server-side Bun context but is conventionally a browser-only concern. It does no harm here.
- **HTML stripping with regex**: `/<[^>]+>/g` strips well-formed HTML tags but is not a full HTML sanitiser. Malformed or nested tags could in theory leave residual angle brackets, but in practice MediaWiki's snippet output is well-formed.
- **`extract` is the REST API summary, not the full article**: The `/page/summary/{title}` endpoint returns only the introduction section. For long articles, this may be several paragraphs; for short stubs, it may be a single sentence. There is no mechanism to fetch subsequent sections.
- **Spaces replaced before encoding**: `title.replace(/ /g, "_")` then `encodeURIComponent(...)` is correct for Wikipedia REST API URLs. However, if the title itself contains a literal underscore (rare but possible), this is a no-op — underscores are not re-encoded by `encodeURIComponent`, which is the correct behaviour for Wikipedia URLs.
- **The `description` field**: `data.description` from the REST API is Wikipedia's short one-line description (the Wikidata description), which is distinct from `extract`. For many articles it is a brief noun phrase (e.g., `"physics phenomenon"`). It may be `undefined` for articles without a Wikidata description.
