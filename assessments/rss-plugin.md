# RSSPlugin Assessment

## Module Overview

`RSSPlugin` enables the agent to fetch and parse RSS 2.0 and Atom 1.0 feeds using a single tool call. The plugin performs its own XML parsing using regular expressions rather than relying on an external XML parser, making it zero-dependency beyond Bun's built-in `fetch`. It supports both feed formats through a unified `RSSFeed` output shape, handles CDATA sections, and normalizes the differences between RSS and Atom (e.g., `<link>` as an attribute in Atom vs. text content in RSS, `<summary>` vs. `<description>`). The plugin is restricted to HTTPS feeds only.

## Interface / Exports

### `class RSSPlugin implements AgentPlugin`

| Member | Signature | Purpose |
|---|---|---|
| `name` | `string = "RSSPlugin"` | Plugin identifier |
| `getSystemPromptFragment()` | `() => string` | Injects single-sentence guidance on when to use `fetch_rss_feed` |
| `getTools()` | `() => ToolDefinition[]` | Returns the single `fetch_rss_feed` tool |
| `executeTool(name, args)` | `async (name, args) => Promise<any>` | Delegates to `fetchFeed` |

### Registered Tools

| Tool | Required args | Optional args | Return shape |
|---|---|---|---|
| `fetch_rss_feed` | `url` | `limit` (default 10, max 50) | `RSSFeed` or `{ error: string }` |

### Internal types (not exported)

```typescript
interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  author?: string;
  guid?: string;
}

interface RSSFeed {
  title: string;
  link: string;
  description: string;
  items: RSSItem[];
}
```

## Configuration

No constructor arguments. No environment variables. The plugin uses `fetch` (Bun built-in) and has no external library dependencies.

## Data Flow

```
executeTool("fetch_rss_feed", { url, limit? })
  → HTTPS prefix check
  → clamp limit to [1, 50]
  → fetch(url, { Accept: XML types, signal: 15s timeout })
  → response.text() (raw XML string)
  → parseFeed(xml, clampedLimit)
      → isAtom? → parseAtomEntries() : parseRSSItems()
  → return RSSFeed | { error: string }
```

The XML string is never written to disk; it is parsed in-memory and immediately discarded after the function returns.

## Code Paths

### URL validation (inline in `fetchFeed`)
Simple string prefix check: `!url.startsWith("https://")` → return `{ error: "Only HTTPS feed URLs are supported" }`. This is less thorough than `FileIOPlugin`'s `validateUrl` — it does not block private/internal addresses.

### Feed format detection (`parseFeed`)
```typescript
const isAtom = /<feed[^>]*xmlns[^>]*atom/i.test(xml) || /<feed>/i.test(xml);
```
Checks whether the root element is `<feed>` with an Atom namespace, or a bare `<feed>` tag. If either matches, Atom parsing is used; otherwise, RSS 2.0 parsing is assumed.

### RSS parsing path
1. Extracts the `<channel>` element content (or falls back to full XML if not found).
2. Calls `extractTag` for feed-level `title`, `link`, `description`.
3. Calls `parseRSSItems(channel, limit)` which iterates `<item>...</item>` blocks via regex.

### Atom parsing path
1. Extracts feed-level `title`, `link` (via `href` attribute), `subtitle` → mapped to `description`.
2. Calls `parseAtomEntries(xml, limit)` which iterates `<entry>...</entry>` blocks via regex.

### `parseRSSItems(channel, limit)`
Iterates all `<item>` blocks using `/<item>([\s\S]*?)<\/item>/gi`. For each item:
- Extracts `title`, `link`, `description` via `extractTag`.
- Falls back `link` to `guid` if `<link>` is empty.
- Extracts `pubDate` with fallback to `dc:date` (Dublin Core).
- Extracts `author` with fallback to `dc:creator` (Dublin Core).
- Stops once `limit` items are collected.

### `parseAtomEntries(xml, limit)`
Iterates all `<entry>` blocks. Link extraction is more complex since Atom uses `<link href="...">` (self-closing with attributes):
1. Tries `extractAttrOrTag` for `rel="alternate"` → `href`.
2. Falls back to `type="text/html"` → `href`.
3. Falls back to any `<link ... href="...">` tag via inline regex.

- `description` maps from `<summary>` or `<content>`.
- `pubDate` maps from `<published>` or `<updated>`.
- `author` maps from `<name>` or `<author>` (the `<name>` tag is a child of `<author>` in Atom; extracting it directly yields the author's name value).

## Helper Functions / Internals

### `extractTag(xml: string, tag: string): string` (module-level)
Extracts the text content of the first occurrence of `<tag>...</tag>`. Handles CDATA sections (`<![CDATA[...]]>`) by trying the CDATA regex first. Returns `""` if not found. Uses case-insensitive matching.

### `extractAttrOrTag(xml: string, tag: string, attr: string, attrValue: string, resultAttr: string): string` (module-level)
Finds a tag element where attribute `attr` equals `attrValue`, and returns the value of `resultAttr` from that same element. Tries both attribute orderings (attr before resultAttr and vice versa) to handle any attribute order in the XML. Returns `""` if not found.

### `parseRSSItems(channel: string, limit: number): RSSItem[]` (module-level)
Regex-based item extraction with early exit on limit.

### `parseAtomEntries(xml: string, limit: number): RSSItem[]` (module-level)
Regex-based entry extraction with early exit on limit.

### `parseFeed(xml: string, limit: number): RSSFeed` (module-level)
Top-level parser that dispatches to the RSS or Atom path based on format detection. Never throws — always returns an `RSSFeed` object, even for non-XML input (fields will be empty strings).

### `fetchFeed(url, limit)` (private)
The single private method. Performs the HTTP fetch, calls `parseFeed`, and returns either the parsed feed or an `{ error }` object. All exceptions are caught.

## Error Handling

| Scenario | Handling |
|---|---|
| Non-HTTPS URL | Returns `{ error: "Only HTTPS feed URLs are supported" }` immediately |
| Fetch timeout (15s) | `AbortSignal.timeout(15_000)` causes `fetch` to throw; caught, returns `{ error: err.message }` |
| Network/DNS error | Caught in `catch` block; returns `{ error: err.message }` |
| HTTP error (4xx, 5xx) | `!response.ok` check returns `{ error: "HTTP <status>: <statusText>" }` |
| XML parse failure | Not explicitly caught — the regex parser returns empty strings for missing fields rather than throwing. A completely non-XML response produces an `RSSFeed` with all-empty fields and zero items |
| `limit` out of range | Clamped: `Math.min(Math.max(1, limit), 50)` |

All errors in `fetchFeed` are caught and returned as `{ error: string }` objects rather than thrown. Callers receive a consistent object shape regardless of success or failure.

## Integration Context

**Registered in:** `src/agents/sub-agents/createWebAgent.ts` alongside `WebSearchPlugin`, `WebReaderPlugin`, and `WikipediaPlugin`.

```typescript
new HeadlessAgent(llm, [new WebSearchPlugin(), new WebReaderPlugin(), new WikipediaPlugin(), new RSSPlugin()], ...)
```

**Depends on:**
- `src/core/Plugin.ts` — `AgentPlugin`, `ToolDefinition`
- `src/logger.ts` — info and error logging
- Bun built-ins: `fetch`, `AbortSignal`

**No files in the codebase import from `RSSPlugin.ts`** outside of the factory function. The plugin is self-contained.

## Observations / Notes

1. **Regex XML parsing is fragile:** The plugin deliberately avoids a parser dependency, but this creates known edge cases that will silently fail or produce incorrect output:
   - Nested `<item>` or `<entry>` tags (rare but valid in some feed extensions).
   - XML entities (`&amp;`, `&lt;`, etc.) in text content — returned as raw entity strings, not decoded.
   - Comments (`<!-- ... -->`) containing tag-like strings that match item patterns.
   - `<link>` tags in RSS with namespace prefixes (e.g., `<atom:link>`).

2. **No private address blocking:** Unlike `FileIOPlugin`, this plugin does not perform SSRF mitigation beyond the HTTPS-only check. An attacker could supply `https://192.168.1.1/feed.rss`. In a sub-agent context where the orchestrator controls URLs, this may be an acceptable trade-off.

3. **`<channel>` extraction is greedy:** The regex `/<channel>([\s\S]*)<\/channel>/i` uses a greedy quantifier. If a feed contains `</channel>` text inside a CDATA block, the extraction boundary will be incorrect.

4. **`author` extraction in Atom is simplified:** In Atom, `<author>` is a structured element containing a `<name>` child. Extracting `<name>` directly works correctly for well-formed feeds but could match non-author `<name>` elements in feeds that use `<name>` for other purposes.

5. **`parseFeed` never throws:** If the input is not valid XML (e.g., an HTML error page returned with a 200 status), the result will be an `RSSFeed` with all-empty-string fields and zero items. The caller receives this as a technically valid response with no error indication.

6. **`name` field inconsistency:** The class property is `name = "RSSPlugin"` rather than the short-form convention used by other plugins (e.g., `"Audio"`, `"Clipboard"`, `"Notes"`). This is a minor naming inconsistency that affects log output and any code that looks up plugins by name.

7. **Feed-level `link` in Atom:** If no `rel="alternate"` link is present, the fallback `<link href="...">` regex may match a `rel="self"` link, producing a self-referential `link` field (the feed URL itself rather than the site homepage).

8. **`limit` is applied during parsing, not after:** Both `parseRSSItems` and `parseAtomEntries` exit the regex loop once `limit` items are collected, rather than parsing all items then slicing. This is efficient for large feeds.
