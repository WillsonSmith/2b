# WebReaderPlugin Assessment

## Module Overview

WebReaderPlugin allows an agent to fetch and extract the readable content of a web page. Given an HTTPS URL, it downloads the raw HTML, parses it with jsdom, extracts all hyperlinks, runs Mozilla's Readability algorithm to isolate the main article body, and returns a structured object with the title, byline, article text, total character count, and a deduplicated links array.

The plugin exists to give the agent "read" access to the web — not just metadata from a search engine, but the actual content of specific pages. It is frequently paired with WebSearchPlugin: the agent searches for relevant URLs, then reads individual pages for detail.

Security is a primary concern. The plugin enforces HTTPS-only and blocks all requests to private/internal IP ranges and special hostnames before any network call is made.

## Interface / Exports

```typescript
export class WebReaderPlugin implements AgentPlugin
```

**Constructor**

No constructor is defined; the default no-arg constructor is used.

**Implemented AgentPlugin hooks**

| Hook | Returns |
|---|---|
| `getSystemPromptFragment()` | Explains the tool, notes HTTPS-only, and tells the LLM about the links array for navigation |
| `getTools()` | One tool definition: `read_webpage` |
| `executeTool(name, args)` | Delegates `read_webpage` to `this.readWebpage(args.url)` |

**Tool: `read_webpage`**

- **Parameter**: `url` (string, required) — the HTTPS URL to fetch.
- **Returns**: `{ title, byline, url, content, total_length, links }` on success, or `{ error, links }` if Readability fails to parse the page.

## Configuration

- **No API key required**.
- **No environment variables**.
- **No constructor options**.
- **Network timeout**: 15 seconds (`AbortSignal.timeout(15_000)`), longer than other plugins, accommodating slower content sites.
- **External dependencies** (lazy-loaded):
  - `jsdom` — DOM parser for HTML
  - `@mozilla/readability` — article extraction algorithm
- **Content truncation**: Article text is capped at 8000 characters.

## Data Flow

```
LLM calls read_webpage { url: "https://example.com/article" }
  → executeTool("read_webpage", { url })
    → readWebpage(url)
      → validateUrl(url)           ← throws if invalid, non-HTTPS, or private IP
      → logger.debug("WebReader", `Fetching: ${url}`)
      → fetch(url, { headers: { User-Agent, Accept }, signal: timeout(15s) })
      → if !res.ok → throw Error("Failed to fetch page: <status>")
      → html = await res.text()
      → lazy-load JSDOM and Readability if not yet imported
      → dom = new JSDOM(html, { url })
      → extract links from dom (before Readability mutates the document)
        → querySelectorAll("a[href]")
        → deduplicate by href
        → filter to http: or https: protocols only
        → collect { text, href }[]
      → reader = new Readability(dom.window.document)
      → article = reader.parse()
      → if !article → return { error: "Could not extract...", links }
      → text = article.textContent, collapse 3+ newlines to 2
      → truncate to 8000 chars, append "[Content truncated...]" if needed
      → return { title, byline, url, content, total_length, links }
```

## Code Paths

### Happy path

1. `validateUrl` is called — parses the URL, verifies `https:` protocol, and checks the hostname against a set of private/internal address patterns.
2. The page is fetched with a browser-like User-Agent and Accept header to reduce bot detection.
3. JSDOM and Readability are lazy-loaded if this is the first call (module-level caching).
4. A JSDOM instance is created with the raw HTML and the original URL (needed for relative link resolution).
5. All `<a href>` elements are iterated before Readability runs, because Readability clones/modifies the document. Links are deduplicated by href using a `Set<string>`. Only `http:` and `https:` hrefs are kept; `javascript:`, `mailto:`, and malformed hrefs are discarded.
6. `Readability.parse()` extracts the article. If it returns `null`, the function returns an error object that still includes the links array.
7. `textContent` has runs of 3+ consecutive newlines collapsed to 2.
8. If the text exceeds 8000 characters it is sliced and `"\n\n[Content truncated...]"` is appended.
9. `total_length` reflects the pre-truncation length so the LLM knows whether truncation occurred.

### URL validation failure

`validateUrl` throws synchronously if:
- The string is not a valid URL.
- The protocol is not `https:`.
- The hostname matches localhost, `127.0.0.1`, `::1`, `0.0.0.0`, any RFC 1918 range (`10.x`, `172.16-31.x`, `192.168.x`), link-local (`169.254.x`), `.internal` TLD, or `.local` TLD.

These throws propagate uncaught through `readWebpage` and `executeTool` to `BaseAgent`'s error handler.

### Readability parse failure

If `reader.parse()` returns `null` (non-article pages, login walls, very sparse content), the function returns `{ error: "Could not extract readable content from this page.", links }`. The links array is still populated, allowing the LLM to navigate elsewhere.

### Fetch failure or timeout

`!res.ok` throws with the HTTP status. Network errors or the 15-second timeout abort the fetch and propagate as throws.

### Link extraction — malformed href

The `new URL(href, baseUrl)` call inside the link extraction loop is wrapped in a try-catch that silently discards malformed hrefs.

### Unknown tool name

`executeTool` returns `undefined` implicitly for names other than `"read_webpage"`.

## Helper Functions / Internals

### `function validateUrl(url: string): URL` (module-level, not exported)

Parses the URL with `new URL()`, checks the protocol, and runs the hostname through a series of checks for private address space. Throws descriptive `Error` objects for each failure case. Returns the parsed `URL` object on success (though the caller does not use the return value — it just checks for throws).

### Lazy-loaded `JSDOM` and `Readability`

Two module-level variables (`let Readability = null`, `let JSDOM = null`) are used to defer the import of `jsdom` and `@mozilla/readability` until the first actual call. This avoids adding their startup cost to agent initialisation. After the first call they are cached and reused.

## Error Handling

| Scenario | Handling |
|---|---|
| Invalid URL format | `validateUrl` throws `"Invalid URL format."` |
| Non-HTTPS URL | `validateUrl` throws `"Only HTTPS URLs are allowed."` |
| Private/internal hostname | `validateUrl` throws `"Requests to private or internal addresses are not allowed."` |
| HTTP error status | `readWebpage` throws `"Failed to fetch page: <status>"` |
| Network timeout (>15s) | `AbortSignal.timeout` causes rejection; propagates as throw |
| Readability returns null | Returns `{ error, links }` — soft error, no throw |
| Malformed href in link extraction | Silently skipped via try-catch |

Throws propagate to `BaseAgent.act()`'s error handler. Soft errors (Readability failure) are returned as structured objects the LLM can reason about.

## Integration Context

WebReaderPlugin is registered in the **web sub-agent** (`src/agents/sub-agents/createWebAgent.ts`), alongside `WebSearchPlugin`, `WikipediaPlugin`, and `RSSPlugin`. The web agent is a `HeadlessAgent` with the persona "web research specialist."

The intended usage pattern within this sub-agent is sequential: WebSearchPlugin finds URLs, WebReaderPlugin reads them. The LLM can use the `links` array in each response to chain reads across related pages.

Call chain:

```
User → CortexAgent
  → SubAgentPlugin.executeTool("web_agent", { task })
    → HeadlessAgent.ask(task)
      → WebReaderPlugin.executeTool("read_webpage", { url })
```

No other module imports WebReaderPlugin.

## Observations / Notes

- **SSRF protection is solid**: The `validateUrl` function blocks all RFC 1918 ranges, link-local, localhost variants, and common internal TLDs. The check uses regex patterns for CIDR ranges rather than IP-to-integer comparisons. One edge case: IPv6 private ranges beyond `::1` (e.g., `fc00::/7` ULA space) are not explicitly checked.
- **Links are extracted before Readability runs**: The comment in the source correctly notes that Readability clones or modifies the document. Extracting links first preserves the full original link set.
- **Both http: and https: links are collected** even though only HTTPS can be fetched. The LLM may follow a link that begins with `http:`, which would then fail `validateUrl`. This is a minor usability gap.
- **`total_length` enables transparency**: By returning the pre-truncation length alongside the truncated content, the LLM knows whether it is seeing the full article or a partial view, and can inform the user or request a more targeted fetch.
- **Content truncation at 8000 characters**: This is a reasonable limit for LLM context windows, but long articles (technical documentation, legal text) will be cut. There is no way for the caller to request a different offset or page through the content.
- **User-Agent spoofing**: The plugin sends a Chrome-on-macOS User-Agent to reduce the likelihood of bot-detection blocks. This is a pragmatic but common approach.
- **`article.byline` may be null**: Readability does not guarantee a byline. The caller receives `null` for `byline` on pages without a detectable author, which is fine but should be handled downstream.
- **Lazy import timing**: The first call to `read_webpage` will incur the overhead of dynamically importing both `jsdom` and `@mozilla/readability`. Subsequent calls reuse the cached references.
