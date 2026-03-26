# Plugin Assessment

**Files covered:**

- `src/plugins/IMemoryDatabase.ts`
- `src/plugins/MemoryPlugin.ts`
- `src/plugins/CortexMemoryDatabase.ts`
- `src/plugins/CortexMemoryPlugin.ts`
- `src/plugins/ThoughtPlugin.ts`
- `src/plugins/AudioPlugin.ts`
- `src/plugins/TimePlugin.ts`
- `src/plugins/ImageVisionPlugin.ts`
- `src/plugins/WebSearchPlugin.ts`
- `src/plugins/WebReaderPlugin.ts`
- `src/plugins/WikipediaPlugin.ts`
- `src/plugins/RSSPlugin.ts`
- `src/plugins/ShellPlugin.ts`
- `src/plugins/ClipboardPlugin.ts`
- `src/plugins/FileIOPlugin.ts`
- `src/plugins/NotesPlugin.ts`
- `src/plugins/WeatherPlugin.ts`
- `src/plugins/TMDBPlugin.ts`
- `src/plugins/YtDlpPlugin.ts`
- `src/plugins/FFmpegPlugin.ts`
- `src/plugins/CodeSandboxPlugin.ts`
- `src/plugins/SubAgentPlugin.ts`
- `src/core/Plugin.ts` (interface)
- `src/core/BaseAgent.ts` (call site)
- `src/core/HeadlessAgent.ts` (call site)
- `src/agents/AgentFactory.ts` (wiring)

---

## AgentPlugin Interface (`src/core/Plugin.ts`)

### Interface contract

The `AgentPlugin` interface defines eight optional hooks:

- `onInit(agent)` — called once during `BaseAgent.start()`. Used to subscribe to agent events or store a reference.
- `getSystemPromptFragment()` — called synchronously on every LLM tick. Returns a static string injected at the end of the assembled system prompt.
- `getContext(currentEvents?)` — called asynchronously on every LLM tick. Returns dynamic, per-turn context (memory hits, current time, etc.).
- `getTools()` — called synchronously on every LLM tick. Returns tool definitions; `BaseAgent` wires `executeTool` as the implementation fallback if no inline `implementation` is set.
- `executeTool(name, args)` — called when the LLM invokes a tool. Should return `undefined` for unknown tool names so other plugins can handle them.
- `onMessage(role, content, source)` — called after every user input and every assistant response.
- `getMessages(limit?)` — called at the start of every LLM tick to rebuild conversation history.
- `augmentResponse(response)` — called after the LLM produces a response, before `speak` is emitted. Can replace the response string.
- `onError(error)` — called when an unhandled error propagates from `act()`.

`ToolDefinition.parameters` is typed as `any` (JSON Schema), giving no compile-time safety on schema shape.

### Key observations

- All hooks are optional; a plugin implementing only `getContext` is valid.
- `executeTool` is not called by `BaseAgent` directly — instead, `BaseAgent` mutates `t.implementation` on every tick to wrap `executeTool`. This mutation is permanent (the closure is written once per tick); it does not interfere with correctness but means the same tool definition object accumulates wrapper closures that reference the same underlying `executeTool`.
- `HeadlessAgent` mirrors this same wiring but skips `onInit`, `onMessage`, `getMessages`, and `augmentResponse`.

---

## IMemoryDatabase (`src/plugins/IMemoryDatabase.ts`)

### Interface contract

Defines a minimal two-method interface:
- `addMemory(text)` — stores a memory with an embedding.
- `search(query, limit?, threshold?)` — returns matching text strings.

### Key observations

- `CortexMemoryDatabase` does not implement this interface; it has a richer, non-conforming API. `MemoryPlugin` accepts an `LLMProvider` directly and does not use this interface at all.
- The interface has no current implementors and is effectively dead code. Its existence could mislead a developer who tries to build a conforming adapter expecting it to be usable with either memory system.

---

## MemoryPlugin (`src/plugins/MemoryPlugin.ts`)

### Interface contract

Implements `onMessage`, `getMessages`. No tools, no context, no system prompt fragment.

### Configuration

- Constructor takes an `LLMProvider` for summarization.
- `MAX_MESSAGES = 15`, `MIN_MESSAGES = 5` — hard-coded, not configurable via constructor.

### Core data flow

1. Every `user` and `assistant` message is pushed to `this.messages`.
2. `system` role messages replace `this.systemPrompt` (not added to history).
3. When `messages.length > 15`, `summarizeOldContext()` is called.
4. `getMessages(limit?)` returns the system prompt (if any) prepended to the last `limit - 1` messages, trimmed further to start on a `user` message.

### Key code paths

**summarizeOldContext**: Determines the split point as `max(0, messages.length - MIN_MESSAGES)`, then advances forward until it finds a `user` message. Messages before that index are formatted and sent to the LLM for summarization. The summary is prepended to the content of the first retained message. On LLM failure, it drops old messages silently without a summary.

**getMessages**: The `limit` adjustment subtracts 1 for the system prompt before slicing. If `limit` is `undefined` or `0`, the full history is returned. The while-loop that trims leading non-user messages could in theory empty the array if all messages are `assistant` type (edge case: freshly started agent receiving only assistant-side messages via `onMessage`).

### Error handling

- Summarization failures are logged and swallowed; history is still trimmed without a summary, which is the correct degraded behavior.
- There is no error handling around `getMessages`; it is synchronous and cannot throw under normal conditions.

### Security / resource concerns

- The summarization call is made using the same `LLMProvider` as the main agent. A very long context burst could result in a blocking LLM call that delays the next tick (summarization happens synchronously within `onMessage` via `await`).
- The `system` role branch silently drops any previous system prompt. If two plugins both invoke `onMessage` with a `system` role, only the last one survives.

### Integration notes

- Registered on the orchestrator agent in `AgentFactory.ts` alongside `SubAgentPlugin` instances.
- `HeadlessAgent` does not invoke `onMessage` or `getMessages`; sub-agents therefore have no history across tool calls within the same `ask()`.
- The `systemPrompt` field is populated only if `onMessage` is called with `role === "system"`, but `BaseAgent.dispatchMessage` is never called with that role. The system prompt stored here will always remain `null` in practice.

---

## CortexMemoryDatabase (`src/plugins/CortexMemoryDatabase.ts`)

### Interface contract

A standalone SQLite-backed store. Not an `AgentPlugin` itself. Key methods:

- `addMemory(text, type, tags)` — embeds and inserts; returns the new ID.
- `search(query, limit, threshold, type?)` — full embedding similarity search.
- `searchWithEmbedding(embedding, limit, threshold, type?)` — avoids redundant embed calls.
- `queryMemories(filter)` — metadata filter query, FTS5 supported.
- `hybridSearch(query, filter, limit, threshold)` — semantic + metadata.
- `aggregateMemories(groupBy, filter?)` — count groups by type, tag, or date.
- `getMemoryTimeline(start, end, limit)` — chronological retrieval.
- `linkMemories(idA, idB)` — bidirectional link via `memory_links`.
- `deleteMemory(id)` — removes memory, links, and FTS entry.
- `updateMemoryText(id, newText)` — re-embeds and updates FTS.

### Configuration

- `dbPath` defaults to `data/<name>.cortex.sqlite` via `appDataPath`.
- `llm` is typed `any`, accepting any object with `getEmbedding(text)`.

### Core data flow

- Schema is initialized on construction; two migrations run on every boot to add the `type` and `tags` columns if absent. The FTS5 table is created once and back-populated on first creation.
- Embeddings are stored as JSON-serialised `TEXT`. Cosine similarity is computed in JavaScript over all rows (no SQLite vector extension).
- `queryMemories` builds a parameterized WHERE clause; the `contains` (FTS5) condition is appended manually.

### Key code paths

**Full-table scan in `searchWithEmbedding`**: All rows are fetched, deserialized, and scored in JavaScript. Performance degrades linearly with database size.

**`aggregateMemories` with `groupBy === "tag"`**: The WHERE clause from `buildWhereClause` is string-stripped of the `WHERE` keyword and reassembled with `je.value != ''` as the first condition. This is fragile: if the clause format changes, the manual `slice("WHERE ".length)` will silently corrupt the query.

**`hybridSearch`**: Retrieves all matching rows (post-filter), scores them, then slices to `limit`. The `limit` parameter is not applied at the SQL level when using filters, so the in-memory slice always happens on potentially the full filtered result set.

**FTS5 back-population**: Uses a single `INSERT INTO memories_fts SELECT` query on first creation. This runs inside `initSchema()` which is called in the constructor — meaning it runs synchronously and blocks the constructor on large existing databases.

### Error handling

- The constructor can throw if SQLite fails to open or if schema queries fail; this is not caught at the call site (`CortexMemoryPlugin` constructor).
- `getEmbedding` errors propagate out of every async method; callers (`CortexMemoryPlugin.getContext`) wrap in try-catch and return empty string on failure.

### Security / resource concerns

- The `contains` filter is passed directly to an FTS5 `MATCH` clause. Malformed FTS5 syntax will cause SQLite to throw, which propagates up to the tool caller. This is surfaced as an error, not silently swallowed.
- No maximum database size enforcement; unbounded memory growth is possible over time.
- Embeddings stored as JSON TEXT consume significant space for high-dimensional models.

---

## CortexMemoryPlugin (`src/plugins/CortexMemoryPlugin.ts`)

### Interface contract

Implements `onInit`, `getSystemPromptFragment`, `getContext`, `getTools`, `executeTool`, `onMessage`. Eleven tools exposed.

### Configuration

- Constructor takes `llmProvider`, `name`, and optional `dbPath`.
- Auto-registered by `CortexAgent` (not manually in `AgentFactory.ts`).

### Core data flow

**`getSystemPromptFragment`**: Synchronously fetches up to 20 `behavior` memories using `getRecentMemories` and injects them as active instructions. This is called on every LLM tick; it performs a synchronous DB query each time.

**`getContext`**: Stores `currentEvents` for use in `onMessage`, clears `savedThisTurn`, then gets a single embedding and runs two `searchWithEmbedding` calls (factual, procedures). Returns a formatted string of up to 3 factual and 1 procedure memory.

**`onMessage`**: After every assistant response, runs autonomous conflict resolution — searches for memories with similarity ≥ 0.85 to the combined current events + response, then deletes (if recent) or marks as superseded (if older). This fires on every `assistant` message turn.

**`executeTool`**: All tool branches are wrapped in a single `try/catch` which catches all errors and logs them, returning `undefined` implicitly. This means tool failures are completely invisible to the LLM.

### Key code paths

**save_memory auto-linking**: After saving, searches for the top 3 similar memories (threshold 0.5) and calls `linkMemories` for each. This requires two additional embedding calls (one was already made for the save).

**Conflict resolution threshold**: The 0.85 threshold is high (near-duplicate), but the query includes both `currentEvents` and the full assistant response, which can produce unexpectedly high similarity to unrelated factual memories if the response is long and topic-overlapping.

**`savedThisTurn` guard**: Memories saved during the current turn are excluded from conflict deletion. This prevents newly-saved memories from immediately being deleted by the resolution step. Cleared at the start of each `getContext` call.

### Error handling

- All `executeTool` errors are swallowed; the LLM receives `undefined` and will likely interpret it as an empty result or produce confusing behavior.
- `getContext` wraps in try-catch and returns empty string on failure.
- `onMessage` wraps conflict resolution in try-catch.

### Security / resource concerns

- `currentEvents` is an instance field mutated by `getContext` and read by `onMessage`. Because `getContext` and `onMessage` are called sequentially within a single tick in `BaseAgent`, this works correctly — but the coupling is non-obvious and fragile under any re-ordering of calls.
- The autonomous deletion in `onMessage` can permanently remove memories without user awareness. High-similarity responses to existing factual memories can cause silent data loss.

### Integration notes

- `db` is public, allowing `ThoughtPlugin` to call `db.addMemory` directly, bypassing the plugin's own `executeTool` path and `savedThisTurn` tracking.
- Auto-registered by `CortexAgent`; manual re-registration in a factory would result in duplicate tools being exposed to the LLM.

---

## ThoughtPlugin (`src/plugins/ThoughtPlugin.ts`)

### Interface contract

Implements `onInit`, `getSystemPromptFragment`, `getTools`, `executeTool`. One tool: `get_recent_thoughts`.

### Configuration

- Constructor takes a `CortexMemoryPlugin` (required) and an optional `synthesisProvider` (`LLMProvider | null`).
- If `synthesisProvider` is `null`, behavioral synthesis is disabled.

### Core data flow

`onInit` subscribes to the agent `thought` event. On each thought:
1. Stores it as `[THOUGHT] <ISO timestamp>: <text>` in the memory DB with type `thought`.
2. If a synthesis provider is configured, fires `synthesizeAndStore` as a fire-and-forget async call.

`synthesizeAndStore` calls the synthesis LLM with up to 1000 chars of the thought, expecting either `SKIP` or a first-person behavioral rule starting with `"I "`. If valid, it checks for exact string duplicates in the last 100 behavior memories before saving.

### Key code paths

**Fire-and-forget synthesis**: The synthesis call does not block the main tick. If the synthesis call is slow, multiple synthesis calls can pile up concurrently without any backpressure or queue.

**Duplicate check**: Uses exact string equality (`m.text === insight`). Two semantically identical but textually different phrasings would both be stored as separate behavior rules.

**Synthesis guard `!reply.startsWith("I ")` **: Quietly drops any valid insight the model returns that doesn't begin with the prescribed prefix. If the model adds whitespace or uses a different capitalization, the rule is silently discarded.

### Error handling

- Thought storage errors are logged via `logger.error`.
- Synthesis errors are caught in the `.catch()` on the fire-and-forget call.
- `executeTool` wraps in try-catch; errors return `undefined`.

### Security / resource concerns

- The synthesis provider is a separate `LLMProvider` instance (or `null`). If it's the same provider as the main agent, concurrent synthesis calls could compete for LLM capacity.
- No rate limiting on thought synthesis; a long reasoning session producing many thoughts would spawn many concurrent LLM calls.

### Integration notes

- Coupled to `CortexMemoryPlugin` through direct `db` access — tightly coupled to the public `db` field.
- Auto-registered by `CortexAgent` with `synthesisProvider = null` (no synthesis), unless the agent is configured with a dedicated synthesis model.

---

## AudioPlugin (`src/plugins/AudioPlugin.ts`)

### Interface contract

Implements `onInit`, `getContext`. No tools. Subscribes to `AudioSystem` events.

### Configuration

- Constructor takes an `AudioSystem` and an `LLMProvider`.
- `isActive` flag suppresses context injection until the first audio event is received.

### Core data flow

`onInit` subscribes to `speech_detected` events from the `AudioSystem`. On each detection:
1. If the transcribed text looks like a Whisper ambient marker (wrapped in `[]` or `()`), routes to ambient.
2. If `noSpeechProb > 0.7`, routes to background noise ambient.
3. Otherwise, calls the LLM with a yes/no intent prompt.
4. `YES` → calls `agent.interrupt()` and `agent.addPerception([Heard "..."])` with `forceTick: true`.
5. `NO` → routes to ambient as `[Overheard background conversation: "..."]`.
6. On LLM classification failure → falls back to treating as direct input (interrupt + addPerception).

### Key code paths

**Intent classification fallback**: On any LLM error, audio is treated as direct input and the agent is interrupted. This is a safe default (never silently ignores user speech) but means any LLM connectivity issue during audio processing causes spurious interrupts.

**`addPerception` routing**: The method uses prefix matching (`[Heard "` or `[User said "`) to decide queue. `AudioPlugin` produces `[Heard "..."]` which matches the first prefix. The ambient events produced by `AudioPlugin` do not match either prefix, so they correctly go to ambient queue.

**`isActive` flag**: `getContext` returns empty string until the first `speech_detected` event fires. The flag is set to `true` on first event and never set back to `false`, even if the audio system stops. The context will always appear once it has been seen.

### Error handling

- LLM intent classification errors are caught and fall back to treating speech as direct input. This is logged via `logger.error`.
- No error handling around `agent.interrupt()` or `agent.addPerception()`.

### Security / resource concerns

- Every non-ambient audio segment triggers a full LLM call for intent classification. High ambient noise environments could result in a very high volume of LLM calls, saturating the model.
- The intent classification uses the same `LLMProvider` as the main agent. Concurrent classification calls and main agent ticks could queue up.

### Integration notes

- Not wired in `AgentFactory.ts` (which uses CLI input). Used in `MicrophoneInputSource`-based configurations.
- Shares the agent's `LLMProvider` instance, not a dedicated fast intent-classification provider.

---

## TimePlugin (`src/plugins/TimePlugin.ts`)

### Interface contract

Implements `onInit`, `getContext`, `getTools`, `executeTool`. One tool: `get_current_time`.

### Configuration

No constructor parameters.

### Core data flow

- `getContext` returns `"The current time is <locale time string>"` on every tick.
- `get_current_time` tool returns `new Date().toString()`.

### Key code paths

**`executeTool` throws for unknown tools**: Unlike the convention stated in `CLAUDE.md` ("return `undefined`, not throw, for unknown tool names"), `TimePlugin.executeTool` throws `new Error('Tool ${name} not found in TimePlugin')`. This exception is caught by `BaseAgent`'s per-plugin try-catch, so it doesn't crash the agent, but it produces an error log entry on every tick where another plugin's tool is routed here first — which cannot happen in practice since `BaseAgent` routes to the specific plugin via `t.implementation`, but the inconsistency is worth noting.

**Duplicate tool**: `AgentFactory.ts` also registers `get_current_time` on `MinimalToolsPlugin`. When both are registered, the LLM sees two `get_current_time` entries. The second registration's implementation overwrites the first on the same tick because `BaseAgent` iterates all plugins and overwrites `t.implementation`. The last plugin wins.

**Locale-dependent output in `getContext`**: `new Date().toLocaleTimeString()` is locale-sensitive. The LLM context injection produces a locale-formatted string, while the tool returns `new Date().toString()` which is locale-aware but differently formatted. The two are inconsistent.

### Error handling

- Throws instead of returning `undefined` for unrecognised tool names (violation of convention).

### Integration notes

- Not registered in `AgentFactory.ts` on the orchestrator or in any sub-agent factory (based on the reviewed files). `MinimalToolsPlugin` provides the equivalent inline.
- If registered alongside `MinimalToolsPlugin`, both time context fragments would be injected every tick, producing redundant context.

---

## ImageVisionPlugin (`src/plugins/ImageVisionPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. Two tools: `analyze_image_url`, `analyze_image_file`.

### Configuration

- `visionModel` defaults to `"google/gemma-3-4b"`.
- `baseUrl` defaults to `"http://127.0.0.1:1234"` (LM Studio local).
- Both are constructor parameters.

### Core data flow

`analyze_image_url`:
1. Validates the URL (HTTPS only, no private/loopback addresses).
2. Fetches the image with a 30-second timeout.
3. Converts to base64 and passes to `callVisionModel`.

`analyze_image_file`:
1. Validates the path stays within `process.cwd()`.
2. Infers MIME type from extension; fails on unsupported types.
3. Reads file, converts to base64, passes to `callVisionModel`.

`callVisionModel`:
1. Posts to `${baseUrl}/v1/chat/completions` with a 60-second timeout.
2. Returns `choices[0].message.content` or a fallback string.

### Key code paths

**Content-type trust**: For URL-fetched images, the MIME type is taken from the `Content-Type` response header without validation against the actual file bytes. A server returning a mismatched content-type could cause the vision model to receive incorrect typing metadata.

**File type detection**: For local files, MIME type is inferred from the extension, not file magic bytes. A file named `photo.jpg` containing PNG data would be sent with `image/jpeg` content type.

**Error return vs. throw**: Both tool entry points return error strings (not throw), which means tool failures are surfaced as model-visible text. The vision model call also returns error strings. This is consistent and appropriate for tool results.

**Path validation**: Uses `relative(resolve(process.cwd()), resolve(filePath))` with a `..` check. Absolute paths are rejected if the relative path is absolute (i.e., the resolved path is not under cwd). This is correct.

### Error handling

- All failures return `"Error: ..."` strings rather than throwing. The agent sees error strings, not exceptions.
- The timeout is set to 30s for image download and 60s for vision model inference — both distinct and reasonable.

### Security / resource concerns

- The SSRF blocklist in `validateImageUrl` is extensive but uses regex-based range checks for RFC1918 addresses. IPv6 private ranges beyond `::1` (e.g., `fc00::/7`) are not blocked.
- Downloaded images are loaded entirely into memory as `ArrayBuffer` before base64 encoding. A very large image (no size cap) could cause an OOM condition.
- The vision model base URL is passed as a constructor argument with no HTTPS requirement. Traffic to the local model is plain HTTP by default.

### Integration notes

- Registered in the `media_agent` sub-agent via `createMediaAgent`.
- The base64-encoded image is embedded in the LLM API request body; very large images will produce very large HTTP request payloads to the local LM Studio instance.

---

## WebSearchPlugin (`src/plugins/WebSearchPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. One tool: `web_search`.

### Configuration

No constructor parameters. Hardcoded to DuckDuckGo Instant Answers API.

### Core data flow

Builds a URL query to `https://api.duckduckgo.com/` with `format=json`, fetches with a 10-second timeout, and returns structured result objects (`answer`, `abstract`, `related`, `web_results`). Returns a `{ message: "No instant answer found..." }` object when all result fields are empty.

### Key code paths

**Empty results**: If DuckDuckGo returns an empty response, the structured `results` object will be empty and the plugin returns a guidance message. This is surfaced to the LLM rather than throwing.

**Errors throw**: Unlike `ImageVisionPlugin`, a non-OK HTTP status throws an `Error`. This is caught by `BaseAgent`'s per-plugin try-catch and logged, but the LLM receives no result and the tool call appears to return `undefined`.

### Error handling

- HTTP errors throw; the exception is swallowed by `BaseAgent` at the `executeTool` dispatch level. The LLM receives no tool response.
- No retry logic.

### Security / resource concerns

- No SSRF risk (hardcoded URL).
- No query length validation; very long queries are passed verbatim to the API.

### Integration notes

- Registered in the `web_agent` sub-agent.
- DuckDuckGo Instant Answers has limited coverage; many queries return no results. The LLM fallback message guides further querying but may produce repeated tool calls.

---

## WebReaderPlugin (`src/plugins/WebReaderPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. One tool: `read_webpage`.

### Configuration

No constructor parameters. Uses lazy-loaded `jsdom` and `@mozilla/readability`.

### Core data flow

1. Validates URL (HTTPS, no private addresses).
2. Fetches with a 15-second timeout.
3. Parses HTML via `JSDOM`, extracts links, then runs `Readability.parse()`.
4. Truncates article text to 8000 characters.
5. Returns `{ title, byline, url, content, total_length, links }`.

### Key code paths

**Lazy imports**: `JSDOM` and `Readability` are imported on first use. The module-level `null` variables are set once and reused. This avoids startup cost but means the first invocation is slower.

**Link extraction before Readability**: Links are extracted from the DOM before `Readability` processes it. The comment says Readability "clones/modifies" the document — however, `Readability` takes the document by reference and mutates it. Links from the original document are correctly captured first.

**Error throw for non-OK responses**: `fetch` failures and non-OK responses throw, which `BaseAgent` catches. The LLM receives no result rather than an error string. This is inconsistent with `ImageVisionPlugin`'s pattern of returning error strings.

**`validateImageUrl` duplication**: `WebReaderPlugin` has its own `validateUrl` function that is nearly identical to the one in `ImageVisionPlugin` and `FileIOPlugin` (same blocklist, same structure). The blocklist in `WebReaderPlugin` is missing `host === "0.0.0.0"` and `host === "metadata.google.internal"` compared to `FileIOPlugin`/`ImageVisionPlugin`.

### Security / resource concerns

- The SSRF blocklist is slightly weaker than other plugins: missing `0.0.0.0` and `metadata.google.internal`.
- HTML content is loaded entirely into memory via `JSDOM`. Very large pages (several MB of HTML) could be slow and memory-intensive.
- No explicit cap on HTML download size before processing.

### Integration notes

- Registered in the `web_agent` sub-agent.
- The 8000-character content truncation may be insufficient for complex articles; `total_length` is returned so the LLM can assess truncation.

---

## WikipediaPlugin (`src/plugins/WikipediaPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. Two tools: `wikipedia_search`, `wikipedia_get_article`.

### Configuration

No constructor parameters. Hardcoded to English Wikipedia API.

### Core data flow

`wikipedia_search`: Calls the MediaWiki action API with `list=search`, strips HTML from snippets, returns `title`, `snippet`, `wordcount`.

`wikipedia_get_article`: Calls the REST API `/page/summary/<encoded title>`, returns `title`, `description`, `extract`, `url`.

### Key code paths

**No timeout set**: Neither `wikipedia_search` nor `wikipedia_get_article` specifies `AbortSignal.timeout()`. If Wikipedia is slow or unresponsive, the request hangs indefinitely, blocking the sub-agent.

**HTTP errors throw**: Non-OK responses throw `Error`. `BaseAgent` swallows these; the LLM receives no result.

**Unknown tool `logger.warn`**: `WikipediaPlugin.executeTool` calls `logger.warn` for unknown tool names rather than returning `undefined`. It does return `undefined` implicitly, so the behaviour is correct, but the log level choice and the inconsistency with the documented convention is a minor issue.

**Logging format inconsistency**: Logger calls use the bracket prefix style (`[WikipediaPlugin]`) in some places, while the rest of the codebase uses the `logger.debug("WikipediaPlugin", ...)` pattern.

### Error handling

- Both methods throw on HTTP errors. No timeout means hanging is possible.
- `executeTool` does not wrap in try-catch; errors propagate to `BaseAgent`.

### Security / resource concerns

- Hardcoded to `en.wikipedia.org`; no SSRF risk.
- No content size limits; large article extracts from the REST API are returned in full.

### Integration notes

- Registered in the `info_agent` sub-agent.

---

## RSSPlugin (`src/plugins/RSSPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. One tool: `fetch_rss_feed`.

### Configuration

No constructor parameters.

### Core data flow

1. Validates URL starts with `"https://"` (prefix check, not full URL parse).
2. Clamps `limit` between 1 and 50.
3. Fetches with 15-second timeout.
4. Parses feed via custom regex-based parser (`parseFeed`).
5. Returns `{ title, link, description, items }`.

### Key code paths

**HTTPS check is a prefix string check**, not a URL parse. A URL like `https%3A//evil.com` or `https://user@...` would pass the prefix check but be a different host. However, `fetch()` will resolve the URL correctly in practice; the main gap is that private IP SSRF blocking is not implemented at all (unlike `WebReaderPlugin`, `FileIOPlugin`, etc.).

**RSS parser is regex-based**: The custom XML parser uses regex patterns. It handles CDATA sections, RSS items, and Atom entries. Edge cases include:
- Feeds with `<item>` tags nested inside `<channel>` but also with `<item>` in other positions: the channel extraction uses a greedy `<channel>([\s\S]*)<\/channel>` match, so the last `</channel>` is used. A malformed feed with multiple `</channel>` occurrences could produce incorrect results.
- The `extractTag` function uses the first match in the XML string, not scoped to the current item's XML. For nested feeds this could bleed across item boundaries, but the caller passes just the item's inner XML to `extractTag`.
- Atom feed detection checks for `xmlns[^>]*atom` in the `<feed>` tag or a bare `<feed>` tag. This would misidentify an RSS feed containing the word "atom" in a `<feed>`-like tag.

**Error handling**: `fetchFeed` wraps in try-catch and returns `{ error: message }` on any exception. This is returned to the LLM as a structured error object, not thrown — consistent and visible.

### Security / resource concerns

- No SSRF blocklist; private IP addresses, localhost, and metadata endpoints are not blocked. A model-controlled URL could be used to probe internal HTTP services.
- No response size cap; a very large feed (e.g., a podcast feed with thousands of items in one XML payload) would be fully downloaded and partially parsed.

### Integration notes

- Registered in the `web_agent` sub-agent.

---

## ShellPlugin (`src/plugins/ShellPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. One tool: `run_shell`.

### Configuration

- `cwd` defaults to `process.cwd()`.

### Core data flow

1. Splits the command string on whitespace.
2. Checks the first token against `ALLOWED_COMMANDS` set.
3. Executes via `Bun.spawn(parts, { cwd, stdout: "pipe", stderr: "pipe" })` — **no shell interpretation**.
4. Truncates stdout to 4096 bytes and stderr to 1024 bytes.
5. Returns `{ stdout, stderr, exitCode }`.

### Key code paths

**No shell operators**: Because `Bun.spawn` is used directly with an array of arguments, shell operators (`|`, `>`, `;`, `&&`) are passed as literal arguments to the command. A command like `cat foo > bar` would pass `>` and `bar` as arguments to `cat`, which would likely error or produce unexpected output rather than redirect.

**Allowlist enforcement**: Only the base command (first token) is checked. Flags and arguments are unrestricted. For example, `cat /etc/passwd` is allowed because `cat` is in the allowlist. Similarly, `find / -name "*.env"` is allowed because `find` is listed. The description says "read-only" but `find` and `cat` can traverse the entire filesystem.

**No timeout**: No `AbortSignal.timeout()` is set. Long-running commands (e.g., `find /` on a large filesystem) will hang indefinitely.

**`proc.exitCode`**: The code reads `proc.exitCode ?? 0` after `await proc.exited`. Once `proc.exited` resolves, `proc.exitCode` should be set; the `?? 0` fallback masks a missing exit code with success.

### Error handling

- `Bun.spawn` failure is caught and returned as `{ exitCode: 1, stderr: message }`.
- No timeout guard.

### Security / resource concerns

- `cat` and `find` can read any file on the system if the user provides absolute paths. The `cwd` restriction only applies to the working directory for relative paths; absolute paths are not blocked.
- `env` and `printenv` expose all environment variables, which may include secrets.
- `echo` can be used with argument expansion in some shells but is safe here since no shell is invoked.
- No output size limit on `stderr` beyond the 1024-byte truncation; a crashing process with large stderr is handled.

### Integration notes

- Registered in the `system_agent` sub-agent.
- The `cwd` parameter is set to `process.cwd()` by default; the sub-agent factory does not override it, so shell commands run in the same working directory as the main process.

---

## ClipboardPlugin (`src/plugins/ClipboardPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. Two tools: `read_clipboard`, `write_clipboard`.

### Configuration

No constructor parameters. Hard-coded to `pbpaste`/`pbcopy` (macOS only).

### Core data flow

- `read_clipboard`: Spawns `pbpaste`, reads stdout.
- `write_clipboard`: Spawns `pbcopy` with `stdin: new Blob([args.text])`.

### Key code paths

**No platform check**: If the plugin is used on a non-macOS system, `pbpaste`/`pbcopy` will not be found, and `Bun.spawn` will throw. The exception is not caught within `executeTool`; it propagates to `BaseAgent` which logs it.

**Exit code ignored**: `await proc.exited` is called but the exit code is not checked. A failed `pbcopy` or `pbpaste` would return `success: true` regardless.

**`read_clipboard` return**: Returns `{ content }` — the content is the raw text from `pbpaste`, which may be empty if the clipboard is empty. No distinction is made between empty clipboard and a clipboard with actual empty content.

**`write_clipboard` size**: No maximum size check on `args.text`. Very large text passed to `pbcopy` would attempt to write the entire string to the clipboard.

### Error handling

- No try-catch in `executeTool`; spawn errors propagate to `BaseAgent`.
- No check on `pbpaste`/`pbcopy` exit codes.

### Security / resource concerns

- Writing arbitrary text to the clipboard is a low-risk operation.
- Reading the clipboard exposes whatever the user has copied, including potentially sensitive data (passwords, tokens). This is inherent to the feature but worth noting.

### Integration notes

- Registered in the `system_agent` sub-agent.
- macOS-only; will silently fail on Linux/Windows via uncaught spawn error.

---

## NotesPlugin (`src/plugins/NotesPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. Four tools: `create_note`, `list_notes`, `read_note`, `delete_note`.

### Configuration

No constructor parameters. Notes directory is `appDataPath("notes")` (evaluated at module load time, not inside the constructor).

### Core data flow

- `safeNotePath(title)`: Strips all non-alphanumeric/underscore/hyphen/space characters, collapses spaces to hyphens, then validates the resolved path stays inside `NOTES_DIR`. Returns the resolved path.
- `create_note`: Writes `# title\n\ncontent` to the path.
- `list_notes`: Scans `NOTES_DIR` for `*.md` files and returns titles (filenames without `.md`).
- `read_note`: Checks file existence, returns content.
- `delete_note`: Checks file existence, calls `unlinkSync` (synchronous).

### Key code paths

**`unlinkSync` is synchronous**: `delete_note` uses the sync `unlinkSync` from `node:fs` while the rest of the plugin is async. This blocks the event loop briefly for the file deletion.

**Title sanitization**: The regex `[^a-zA-Z0-9_\- ]` is permissive — it strips most special characters. A title like `../etc/passwd` would become `etcpasswd` (after stripping `/`), which is safe. However, a title composed entirely of stripped characters (e.g., `!@#$`) would produce an empty string, which `safeNotePath` catches with `throw new Error("Invalid note title.")`.

**`create_note` overwrites silently**: There is no existence check before writing. A `create_note` call on an existing title silently overwrites it. The tool description says "Create or overwrite", so this is intentional but may surprise users who expect creation-only semantics.

**`list_notes` returns filenames without note title metadata**: The returned list shows sanitized filenames (hyphens instead of spaces), not the original titles as stored in the file. If a user saved a note with the title `My Recipe` it would appear in the list as `My-Recipe`.

### Error handling

- `safeNotePath` throws on invalid titles; these propagate out of `executeTool` to `BaseAgent`.
- `read_note` and `delete_note` return `{ error: "Note not found" }` rather than throwing when a note doesn't exist — inconsistent with `safeNotePath` which throws.
- No try-catch wrapping `executeTool` overall.

### Security / resource concerns

- Note content is unrestricted; the plugin will write whatever string the LLM provides.
- The `NOTES_DIR` is evaluated at module load time. If the working directory changes after load (unlikely but possible), `appDataPath` might resolve to an unexpected location.

### Integration notes

- Registered in the `info_agent` sub-agent.
- The directory is not created if it doesn't exist; `Bun.write` will fail silently if the parent path is missing. This is handled by `appDataPath` which should ensure the directory exists.

---

## FileIOPlugin (`src/plugins/FileIOPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. Four tools: `download_file`, `read_file`, `write_file`, `list_directory`.

### Configuration

No constructor parameters. `BASE_DIR` and `DOWNLOADS_DIR` are module-level constants set to `process.cwd()` at module load time.

### Core data flow

- `validateUrl`: Parses the URL, requires HTTPS, blocks private/loopback addresses, returns the parsed `URL`.
- `validatePath`: Resolves `BASE_DIR + path`, checks it stays within `BASE_DIR`.
- `validateDestination`: Resolves and checks the path stays within `DOWNLOADS_DIR`.
- `download_file`: Validates URL, derives filename, validates destination, fetches (60s timeout), checks size (100MB cap), writes.
- `read_file`: Validates path, checks size (1MB cap), reads and returns text.
- `write_file`: Validates path, writes using `Bun.write` (which creates parent directories).
- `list_directory`: Validates path, reads directory entries with `readdir`.

### Key code paths

**Download size check is two-phase**: First checks `Content-Length` header, then checks actual buffer size after full download. If `Content-Length` is absent (many servers omit it), the entire file is downloaded before the size check fires. A 500MB file without a `Content-Length` header would be fully buffered in memory before rejection.

**`destination` filename sanitization**: `destination.replace(/[/\\]/g, "")` strips path separators from the provided filename. This prevents path traversal through the destination parameter, but the result is passed to `validateDestination` which provides a second check.

**`write_file` creates parent directories**: `Bun.write` with a path creates missing intermediate directories automatically. This means the LLM can create arbitrary directory structures within `BASE_DIR` without an explicit mkdir step.

**Errors throw**: All error paths in the tool implementations throw `Error` objects. `BaseAgent` catches them at the plugin level; the LLM sees no result rather than an error message.

### Error handling

- All errors throw; `BaseAgent` swallows them. This is inconsistent with `RSSPlugin` and `ImageVisionPlugin` which return error strings.
- No try-catch inside `executeTool`; all errors propagate.

### Security / resource concerns

- SSRF protection is comprehensive (matches `ImageVisionPlugin`'s blocklist including `0.0.0.0` and `metadata.google.internal`).
- `write_file` can overwrite any file within `BASE_DIR`, including source files and configuration. There is no read-only or protected path concept.
- The 1MB read limit prevents large file disclosure to the LLM context but does not prevent reading sensitive files (e.g., `.env`, private keys).
- `list_directory` exposes directory structure including file sizes, which could aid in reconnaissance within the working directory.

### Integration notes

- Registered in the `system_agent` sub-agent.
- `BASE_DIR` is fixed at module load time; if the module is imported before `process.cwd()` is set to the intended directory, the base will be wrong.

---

## WeatherPlugin (`src/plugins/WeatherPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. One tool: `get_weather`.

### Configuration

No constructor parameters. Uses Open-Meteo and its geocoding API (no API key required).

### Core data flow

1. Geocodes the location string via `https://geocoding-api.open-meteo.com/v1/search` (10s timeout).
2. If no results, returns `{ error: "Location not found" }`.
3. Fetches current weather from `https://api.open-meteo.com/v1/forecast` (10s timeout).
4. Returns structured weather object with human-readable WMO code description.

### Key code paths

**Geocoding uses first result**: `count=1` is passed to the geocoding API, so the first match is used. For ambiguous location names (e.g., "Springfield"), the first geocoding result may not match the user's intent, with no feedback about alternatives.

**Errors throw**: Both `fetch` calls throw on non-OK responses. These propagate to `BaseAgent`.

**WMO code fallback**: `WMO_DESCRIPTIONS[c.weather_code] ?? \`Code ${c.weather_code}\`` — unknown codes are returned as the raw numeric code, which is reasonable.

### Error handling

- Network errors and non-OK responses throw.
- Geocoding "not found" returns `{ error: ... }` rather than throwing — inconsistent within the same method.

### Security / resource concerns

- Hardcoded to Open-Meteo and its geocoding API; no SSRF risk.
- The `timezone` field from geocoding is passed directly to the Open-Meteo API as `timezone` parameter. A malicious geocoding response could inject an unexpected timezone value, but this is a trusted service.

### Integration notes

- Registered in the `info_agent` sub-agent.
- No caching; every call makes two sequential HTTP requests.

---

## TMDBPlugin (`src/plugins/TMDBPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. Seven tools: `search_movies`, `get_movie_details`, `get_movie_credits`, `get_movie_recommendations`, `get_trending_movies`, `search_person`, `get_person_details`.

### Configuration

- `apiKey` defaults to `process.env.TMDB_API_KEY ?? ""`.
- If the key is empty, all tool calls return `{ error: "TMDB_API_KEY is not set." }`.

### Core data flow

All tools route through `tmdbFetch(path, params)`, which:
1. Builds a URL from `TMDB_BASE_URL`.
2. Adds `Authorization: Bearer <key>` header.
3. Fetches with 10-second timeout.
4. Throws on non-OK responses.

Each tool maps the API response into a trimmed, flat object.

### Key code paths

**API key in Bearer token**: The key is sent as an HTTP Authorization header. It is not logged.

**`getPersonDetails` parallel fetch**: Calls `Promise.all` for the person details and movie credits endpoints simultaneously. If either fails, the whole call throws.

**Error throw path**: `tmdbFetch` throws on non-OK responses; the LLM sees no result rather than an error string.

**`get_trending_movies` has `required: []`**: The schema correctly marks `time_window` as optional, and the default of `"week"` is applied in `executeTool`.

### Error handling

- All errors throw from `tmdbFetch` and propagate through `executeTool` to `BaseAgent`.
- The API key absence check returns `{ error }` from `executeTool` before any fetch — this is correct and visible to the LLM.

### Security / resource concerns

- The API key is stored in an instance variable. Logging statements never include the key.
- No rate limiting; rapid repeated tool calls could exhaust TMDB API quotas.

### Integration notes

- Registered in the `info_agent` sub-agent.
- `TMDB_API_KEY` must be present in the environment; missing key produces a user-visible error on every tool call rather than silently skipping tool registration.

---

## YtDlpPlugin (`src/plugins/YtDlpPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. One tool: `download_video_clip`.

### Configuration

No constructor parameters. Requires `yt-dlp` in PATH. Saves to `downloads/` (relative to CWD).

### Core data flow

1. Normalizes start/end timestamps to `HH:MM:SS`.
2. Builds a `yt-dlp` command with `--download-sections *HH:MM:SS-HH:MM:SS` and `--force-keyframes-at-cuts`.
3. Runs via `Bun.$` template literal shell.
4. Parses `yt-dlp` stdout to extract the output filename.

### Key code paths

**`Bun.$` shell execution**: Unlike `ShellPlugin` which uses `Bun.spawn` without a shell, `YtDlpPlugin` uses the `Bun.$` template literal which does invoke a shell. The `url`, `section`, and `outputTemplate` variables are interpolated. `Bun.$` shell-escapes individual arguments in the template literal, so injection through those variables is prevented by the escaping behavior.

**`normalizeTimestamp` with 1-part input**: If the user provides a single-part timestamp (e.g., `"90"` for 90 seconds), `parts.length === 1` and neither the 2-part nor 3-part branch applies. The raw string is returned unchanged, which `yt-dlp` may or may not accept. No validation error is raised.

**No timeout**: `yt-dlp` downloads can take arbitrarily long. There is no timeout on the `Bun.$` call. This is noted in `AgentFactory.ts` ("No timeouts — downloads and transcodes can take arbitrarily long.") and the `media_agent` is correctly registered with no timeout.

**Output filename parsing**: Regex matches on `[download] Destination:` and `[Merger] Merging formats into`. If `yt-dlp` produces neither pattern (e.g., file already exists and is skipped), `outputFile` falls back to the template string which contains `%(ext)s` literally — a non-expanded placeholder.

**`DOWNLOADS_DIR` is not ensured**: Unlike `FFmpegPlugin`, `YtDlpPlugin` does not call a `mkdir -p` equivalent before download. `yt-dlp` will create the directory itself if needed, but if it fails to do so, the operation fails without a clear error.

### Error handling

- `yt-dlp` failures are caught via `try/catch` on the `Bun.$` call; `err.stderr` is returned as `{ success: false, error: ... }`.
- No validation on the `url` parameter (no SSRF check, no protocol restriction).

### Security / resource concerns

- The `url` parameter is not validated before being passed to `yt-dlp`. While `Bun.$` escapes arguments, `yt-dlp` will attempt to connect to any URL, including internal network addresses. This could be used to probe internal services if the machine running the agent has network access to them.
- `yt-dlp` writes to `downloads/` which is within the working directory; no path traversal risk from the output.
- No file size cap; very long video clips would fill disk space.

### Integration notes

- Registered in the `media_agent` sub-agent with no timeout.
- `yt-dlp` must be installed and in PATH; absence produces a spawn error that propagates as `{ success: false, error: ... }`.

---

## FFmpegPlugin (`src/plugins/FFmpegPlugin.ts`)

### Interface contract

Implements `getSystemPromptFragment`, `getTools`, `executeTool`. Thirteen tools.

### Configuration

No constructor parameters. Requires `ffmpeg` and `ffprobe` in PATH. Outputs to `downloads/`.

### Core data flow

Each tool:
1. Validates input paths via `validateInputPath` (no path traversal outside CWD).
2. Calls `ensureDownloadsDir()` (idempotent, cached after first call).
3. Runs an `ffmpeg` or `ffprobe` command via `Bun.$`.
4. Returns `{ success, output_file }` or `{ success: false, error: stderr }`.

### Key code paths

**`validateInputPath` does not block absolute paths outside CWD**: `relative(process.cwd(), resolve(filePath))` — if `filePath` is an absolute path inside CWD, `relative` returns a non-`..` path and validation passes. If it is outside, validation correctly fails. This is correct behavior.

**`outPath` only uses `basename`**: Output filenames are sanitized via `basename(filename)` before joining with `DOWNLOADS_DIR`. This prevents the `output_filename` argument from creating files outside `downloads/`.

**`ffmpeg_concatenate` temp file**: The concat list file is written to `downloads/_concat_list_<timestamp>.txt`. If two concurrent concatenation calls happen simultaneously (unlikely but possible since `dirEnsured` is an instance field), both would write distinct temp files (due to the `Date.now()` suffix) so there is no race on the file content. The temp file is cleaned up in both success and failure paths.

**`ffmpeg_images_to_video` with no inputs**: If both `input_pattern` and `input_files` are absent or empty, the early guard returns an error. However, if `input_pattern` is an empty string `""`, the guard `!inputPattern` evaluates to `true` (empty string is falsy), so an empty string pattern is treated as absent — correct.

**`buildAtempoChain`**: For `speed > 2.0`, the function chains `atempo=2.0` filters. For `speed = 4.0`, this produces `atempo=2.0,atempo=2.0` (since `remaining = 4/2 = 2.0`, and `while (remaining > 2.0)` exits immediately on the boundary value 2.0), and then appends `atempo=2.0` again — resulting in three `atempo=2.0` filters instead of two. This is an off-by-one: the boundary `2.0` is handled by neither the `> 2.0` loop nor the `< 0.5` loop, so the remaining `2.0` is emitted as a final `atempo=2.0`. The chain `atempo=2.0,atempo=2.0,atempo=2.0` produces 8× speed, not 4×.

**`ffmpeg_speed` speed range validation**: The check `speedFactor < 0.25 || speedFactor > 4` is applied before `buildAtempoChain` is called. The `buildAtempoChain` bug at exactly `4.0` could produce incorrect audio speed, but the erroneous behavior is within the validated range.

**`Bun.$` injection**: All `ffmpeg` arguments are passed as template literal variables; `Bun.$` shell-escapes them. However, `cropFilter` and `scale` are string-interpolated into a `-vf` filter value (e.g., `crop=${width}:${height}:${x}:${y}`). These values come from `args.width`, `args.height`, etc. — numeric LLM arguments. Since they are passed as a single string variable to `Bun.$`, the entire `-vf` value is shell-escaped as one argument, preventing injection through the values themselves.

### Error handling

- All tools return `{ success: false, error: stderr }` on failure; errors are never thrown.
- `ffprobe` JSON parse failure would throw from `JSON.parse`; this is caught by the surrounding try-catch.

### Security / resource concerns

- Input path validation prevents reading from outside CWD, but does not prevent overwriting existing files within CWD (via `output_filename` pointing to an existing file, though `outPath` constrains to `downloads/`).
- No file size limits on inputs; very large video files can be processed.
- The `-y` flag on all `ffmpeg` commands silently overwrites existing output files in `downloads/` without prompting.

### Integration notes

- Registered in the `media_agent` sub-agent with no timeout.
- `dirEnsured` is an instance flag; if the `downloads/` directory is deleted while the agent is running, `ensureDownloadsDir` will not re-create it (the flag stays `true` after the first successful creation).

---

## CodeSandboxPlugin (`src/plugins/CodeSandboxPlugin.ts`)

### Interface contract

Implements `onInit`, `getSystemPromptFragment`, `getTools`, `executeTool`. One tool: `execute_code`.

### Configuration

- `codeModel` defaults to `"qwen2.5-coder-7b-instruct-mlx"`, overridable via `CODE_MODEL` env var.
- Uses `LMStudioClient` directly (not via the shared `LLMProvider` abstraction).
- Runtime is auto-detected as `docker` or `apple-container`.

### Core data flow

1. `onInit` fires `ensureInitialized()` eagerly (pre-pulls Docker image).
2. `executeTool` validates `task` (non-empty, ≤4096 bytes) and `input_data` (valid JSON, ≤256KB).
3. Generates Python code via the dedicated coding model.
4. Builds container run arguments for Docker or Apple Container.
5. Launches the container via `Bun.spawn`, races against a `setTimeout` kill.
6. Returns `{ stdout, stderr, exitCode, success, timedOut, generatedCode }`.

### Key code paths

**Lazy vs. eager init**: `onInit` calls `ensureInitialized()` without `await`. The init (which includes `container system start` and `docker pull`) runs in the background. If `executeTool` is called before init completes, `ensureInitialized()` returns the same `initPromise` and `await`s it, correctly serializing. This is safe.

**Code generation via direct LMStudio SDK**: Unlike other plugins that use the shared `LLMProvider`, `CodeSandboxPlugin` constructs its own `LMStudioClient` and accesses the coding model via `lmClient.llm.model(this.codeModel)`. If the LM Studio server is unavailable or the model is not loaded, this throws, propagating out of `executeTool`.

**Timeout mechanism**: `setTimeout` fires `proc.kill("SIGKILL")` and resolves the `timeoutRace`. `Promise.race([proc.exited, timeoutRace])` picks whichever completes first. After kill, stdout/stderr are still read via `new Response(proc.stdout).text()`. If the process was killed, these reads may return partial or empty output; they do not hang because the process is dead.

**`generateCode` does not validate generated code**: The code model's output is stripped of markdown fences and executed directly. A misbehaving code model could generate code that attempts to read `/proc/self/environ` or similar; this would succeed within the container's allowed filesystem scope (only `/tmp` is writable but the filesystem is read-only, so `/proc` and other pseudo-filesystems would be accessible depending on Docker/Apple Container defaults).

**Apple Container `--read-only` flag**: The Apple Container `buildRunArgs` includes `--read-only` but the Docker args also include `--read-only`. Both also include `--tmpfs /tmp` so code can write temporary files.

**Docker `--tmpfs` options**: The Docker tmpfs uses `noexec,nosuid,nodev` flags which prevent executing binaries from `/tmp`. The Apple Container `--tmpfs /tmp` does not include these flags, leaving code execution from `/tmp` possible under Apple Container.

### Error handling

- `task` and `input_data` validation throw; these propagate to `BaseAgent`.
- Code generation errors throw.
- Container execution errors are caught by the overall try flow (errors in `Bun.spawn` itself would surface before the race).
- The return value includes `success: exitCode === 0` and `timedOut`; errors within the container are visible via `stderr` and `exitCode`.

### Security / resource concerns

- Container isolation is the primary security boundary. Docker hardening is thorough: `--network=none`, `--cap-drop=ALL`, `--security-opt=no-new-privileges:true`, `--pids-limit=64`, `--user=65534`, `--read-only`.
- Apple Container hardening lacks `--network` none equivalent (the comment states network is disabled by omitting `--network`, but this depends on the Apple Container CLI's default behavior, which may differ from Docker).
- `input_data` is passed as an environment variable via `-e INPUT_DATA=...`. Environment variables have size limits on most systems (typically 128KB or 256KB). Large `input_data` values at the upper limit may cause `execve` failures.
- The code model is not sandboxed; a prompt injection in `task` could potentially coerce the code model into generating harmful code, though the container would limit what that code can do.

### Integration notes

- Registered in the `system_agent` sub-agent.
- Uses `LMStudioClient` directly; the code model must be loaded in LM Studio separately from the main chat model. No fallback if the code model is unavailable.

---

## SubAgentPlugin (`src/plugins/SubAgentPlugin.ts`)

### Interface contract

Implements `onInit`, `getTools`, `executeTool`. Exposes one tool named after `toolName`.

### Configuration

- `toolName` — used as both the plugin `name` and the exposed tool name.
- `description` — tool description passed to the LLM.
- `agent` — a `HeadlessAgent` instance.
- `inactivityTimeoutMs` (optional) — resets on each sub-agent tool call.
- `absoluteTimeoutMs` (optional) — hard cap on the full `ask()`.

### Core data flow

`onInit` wires the sub-agent's `toolCallHandler` to forward tool calls to the parent agent's `tool_call` event. This allows sub-agent tool calls to appear in the orchestrator's `[tool]` output.

`executeTool`:
- With no timeouts: delegates directly to `agent.ask(args.task)`.
- With timeouts: creates a `Promise<never>` with a `rejectTimeout` closure, wires inactivity reset to `onActivityReset`, and races `agent.ask()` against the timeout promise.

### Key code paths

**Concurrent call race on `onActivityReset`**: The comment in the source explicitly documents that `onActivityReset` is an instance field overwritten per call. Two concurrent `executeTool` calls on the same instance would share and corrupt this field. In practice, the orchestrator calls sub-agents serially within a single LLM tick, so this is safe in the current wiring.

**Timeout rejection is unhandled in sub-agent**: When `timeoutRace` rejects, `Promise.race` rejects with the timeout `Error`. This propagates out of `executeTool` as a thrown error, which `BaseAgent` catches and logs. The LLM sees no tool result.

**`inactivityTimeoutMs` reset trigger**: The inactivity timer is reset via `onActivityReset` which is called from the `toolCallHandler`. The `toolCallHandler` fires when the sub-agent's LLM invokes a tool. Extended computation within a single tool call (e.g., a long FFmpeg transcode) does not reset the inactivity timer; only new tool calls do.

**HeadlessAgent limitations**: `HeadlessAgent` does not invoke `onInit`, `onMessage`, `getMessages`, or `augmentResponse`. Sub-agents therefore have no conversation history across `ask()` calls, no response augmentation, and plugins that rely on `onInit` (e.g., `ThoughtPlugin`, `AudioPlugin`) do not activate in sub-agents.

### Error handling

- Timeout errors throw and are caught by `BaseAgent`.
- Sub-agent internal errors (from `agent.ask()`) propagate through `executeTool` to `BaseAgent`.

### Integration notes

- Each `SubAgentPlugin` holds one `HeadlessAgent` instance; the agent's plugin state persists across calls if any plugin holds state (e.g., `CodeSandboxPlugin`'s `initPromise` and `dirEnsured` flags).
- Registered in `AgentFactory.ts` for `media_agent` (no timeout), `web_agent` (60s inactivity / 120s absolute), `system_agent` (30s inactivity / 120s absolute), `info_agent` (15s inactivity / 30s absolute).

---

## Summary Table

| Plugin | Area | Severity | Issue |
|---|---|---|---|
| `IMemoryDatabase` | Dead code | Low | Interface has no implementors; `CortexMemoryDatabase` does not conform to it and `MemoryPlugin` ignores it entirely. Misleads future developers. |
| `MemoryPlugin` | Integration | High | `systemPrompt` field is populated only when `onMessage` is called with `role === "system"`, but `BaseAgent.dispatchMessage` is never called with that role. The system prompt stored here is always `null`. |
| `MemoryPlugin` | Configuration | Low | `MAX_MESSAGES` and `MIN_MESSAGES` are hard-coded constants; not configurable via constructor. |
| `MemoryPlugin` | Core data flow | Medium | Summarization blocks the `onMessage` call with an `await` LLM call, delaying the current tick's completion. |
| `CortexMemoryDatabase` | Performance | Medium | `searchWithEmbedding` performs a full-table scan for every similarity query; no indexing or approximate nearest-neighbor strategy. Performance degrades linearly with memory count. |
| `CortexMemoryDatabase` | Performance | Medium | `hybridSearch` applies the `limit` slice in memory after fetching all filtered rows; the SQL `LIMIT` is absent, making large filtered result sets expensive. |
| `CortexMemoryDatabase` | Code quality | Medium | `aggregateMemories` with `groupBy === "tag"` uses manual string manipulation (`slice("WHERE ".length)`) to rebuild the WHERE clause. Fragile if clause format changes. |
| `CortexMemoryDatabase` | Startup | Low | FTS5 back-population in `initSchema()` runs synchronously in the constructor, blocking on large existing databases. |
| `CortexMemoryPlugin` | Error handling | High | All `executeTool` errors are caught by a single outer `try/catch` that returns `undefined`. LLM receives no feedback on tool failure. |
| `CortexMemoryPlugin` | Data integrity | High | Autonomous conflict resolution in `onMessage` can permanently delete or overwrite memories without user awareness. High-similarity assistant responses can trigger silent data loss. |
| `CortexMemoryPlugin` | Integration | Medium | `currentEvents` is an instance field mutated by `getContext` and read by `onMessage`. The correctness relies on `BaseAgent` calling these in a fixed order within a tick. |
| `CortexMemoryPlugin` | Integration | Low | `db` is `public`, allowing `ThoughtPlugin` to bypass plugin API and `savedThisTurn` tracking. |
| `ThoughtPlugin` | Resource | Medium | Fire-and-forget synthesis calls pile up without backpressure; a long reasoning session spawns many concurrent LLM requests. |
| `ThoughtPlugin` | Reliability | Low | Behavioral insight deduplication is exact string equality only; semantically equivalent but textually different rules are both stored. |
| `ThoughtPlugin` | Reliability | Low | Synthesis result is silently discarded if it does not start with `"I "` (e.g., due to leading whitespace or capitalisation variation in model output). |
| `AudioPlugin` | Resource | Medium | Every non-ambient audio segment triggers a full LLM call for intent classification using the same provider as the main agent. High ambient noise environments can saturate model capacity. |
| `AudioPlugin` | Reliability | Medium | LLM intent classification failure falls back to treating all audio as direct input and interrupting the agent — the safe choice, but spurious interrupts on connectivity loss. |
| `AudioPlugin` | State | Low | `isActive` flag is never reset to `false`; audio context is injected every tick after any audio event, even if the audio system has stopped. |
| `TimePlugin` | Convention violation | Low | `executeTool` throws `new Error(...)` for unknown tool names instead of returning `undefined` as the documented convention requires. |
| `TimePlugin` | Duplicate tool | Medium | `AgentFactory.ts` also registers `get_current_time` via `MinimalToolsPlugin`. If both are registered, the LLM sees two identical tool names; the last plugin's implementation wins. |
| `TimePlugin` | Consistency | Low | `getContext` uses `toLocaleTimeString()` while the `get_current_time` tool returns `new Date().toString()` — different formats for the same information. |
| `ImageVisionPlugin` | Security | Medium | No download size cap for URL-fetched images; large images are fully buffered in memory before base64 encoding. |
| `ImageVisionPlugin` | Security | Low | IPv6 private ranges beyond `::1` (e.g., `fc00::/7`) are not blocked by the SSRF guard. |
| `ImageVisionPlugin` | Reliability | Low | MIME type for URL images is taken from the server `Content-Type` header without validation; for local files it is inferred from file extension rather than magic bytes. |
| `WebSearchPlugin` | Error handling | Medium | Non-OK HTTP responses throw; `BaseAgent` swallows the exception and the LLM receives no tool result — invisible failure. |
| `WebReaderPlugin` | Security | Medium | SSRF blocklist is missing `0.0.0.0` and `metadata.google.internal` compared to `FileIOPlugin` and `ImageVisionPlugin`. |
| `WebReaderPlugin` | Error handling | Medium | Non-OK HTTP responses throw; `BaseAgent` swallows the exception. LLM receives no result rather than an error string — inconsistent with `ImageVisionPlugin`'s pattern. |
| `WebReaderPlugin` | Resource | Low | No cap on HTML download size before JSDOM parsing; very large pages are fully downloaded and parsed in memory. |
| `WikipediaPlugin` | Reliability | High | Neither `wikipedia_search` nor `wikipedia_get_article` sets a request timeout. Slow or unresponsive Wikipedia will hang the sub-agent indefinitely. |
| `WikipediaPlugin` | Convention | Low | Logging uses bracket-prefix style (`[WikipediaPlugin]`) in some calls rather than the codebase-standard `logger.debug("WikipediaPlugin", ...)` pattern. |
| `WikipediaPlugin` | Convention | Low | `executeTool` calls `logger.warn` for unknown tool names; the convention is to return `undefined` silently. |
| `RSSPlugin` | Security | High | No SSRF blocklist on the `url` parameter; private IPs, localhost, and metadata endpoints are accessible. Only protocol is checked (`https://`). |
| `RSSPlugin` | Security | Low | HTTPS check is a string prefix check, not a URL parse; unusual URL forms could bypass it in edge cases. |
| `RSSPlugin` | Reliability | Low | Custom regex XML parser is fragile on malformed or unusual feeds; specifically, the greedy `<channel>` extraction and cross-scope `extractTag` behavior. |
| `RSSPlugin` | Resource | Low | No response size cap before parsing; large feed XML is fully downloaded. |
| `ShellPlugin` | Security | High | `cat`, `find`, and other allowed commands can read files anywhere on the filesystem via absolute paths. CWD restriction only applies to the working directory for relative paths; absolute paths bypass it. |
| `ShellPlugin` | Security | High | `env` and `printenv` are in the allowlist; environment variables (potentially including API keys and secrets) are fully exposed. |
| `ShellPlugin` | Reliability | High | No timeout on shell command execution; long-running commands (e.g., `find /`) hang indefinitely. |
| `ClipboardPlugin` | Reliability | Medium | No platform check; will throw an uncaught exception on non-macOS systems when `pbpaste`/`pbcopy` are not found. |
| `ClipboardPlugin` | Reliability | Low | Exit codes from `pbpaste`/`pbcopy` are not checked; a failed clipboard operation returns `success: true`. |
| `NotesPlugin` | Error handling | Medium | `safeNotePath` throws on invalid titles (propagates to `BaseAgent`), while `read_note`/`delete_note` return `{ error }` objects for missing files — inconsistent error surface within the same plugin. |
| `NotesPlugin` | Data flow | Low | `list_notes` returns sanitized filenames (with hyphens instead of spaces) rather than the original note titles. |
| `NotesPlugin` | Code quality | Low | `delete_note` uses synchronous `unlinkSync` while the rest of the plugin is async. |
| `FileIOPlugin` | Resource | Medium | `download_file` buffers the entire file in memory before checking size when `Content-Length` is absent; a 500MB file without `Content-Length` would OOM before rejection. |
| `FileIOPlugin` | Error handling | Medium | All errors throw; LLM receives no tool result on failure — inconsistent with `RSSPlugin` and `ImageVisionPlugin` which return error strings. |
| `FileIOPlugin` | Security | Low | `read_file` can read sensitive files (`.env`, private keys) within the working directory; no path-level filtering beyond the CWD boundary. |
| `WeatherPlugin` | Reliability | Low | Geocoding uses first match only; ambiguous location names silently pick the wrong location with no user-visible alternatives. |
| `WeatherPlugin` | Error handling | Low | `executeTool` mixes throw (on HTTP error) and `{ error }` return (on geocoding no-results) within the same method. |
| `TMDBPlugin` | Error handling | Medium | All `tmdbFetch` errors throw; LLM receives no tool result on failure. |
| `YtDlpPlugin` | Security | Medium | The `url` parameter is not validated before passing to `yt-dlp`; internal network addresses can be probed via yt-dlp's HTTP client. |
| `YtDlpPlugin` | Reliability | Medium | `normalizeTimestamp` does not handle single-part timestamps (e.g., `"90"`); the raw string is passed to yt-dlp unchanged without any validation error. |
| `YtDlpPlugin` | Reliability | Low | Output filename fallback returns the unexpanded template string `%(ext)s` when `yt-dlp` output matches neither regex pattern. |
| `FFmpegPlugin` | Correctness | High | `buildAtempoChain` at exactly `speed = 4.0` produces three `atempo=2.0` filters (8× speed) instead of two (4× speed) due to an off-by-one at the boundary value. |
| `FFmpegPlugin` | Reliability | Low | `dirEnsured` flag means `downloads/` is not re-created if deleted while the agent is running. |
| `FFmpegPlugin` | Code quality | Low | The `-y` flag on all `ffmpeg` commands silently overwrites existing output files without warning. |
| `CodeSandboxPlugin` | Security | Medium | Apple Container `--tmpfs /tmp` does not include `noexec,nosuid,nodev` flags that the Docker path uses; code execution from `/tmp` is possible under Apple Container. |
| `CodeSandboxPlugin` | Reliability | Medium | `generateCode` uses `LMStudioClient` directly without a timeout; if the code model is slow or unavailable, the call hangs indefinitely. |
| `CodeSandboxPlugin` | Reliability | Medium | `onInit` fires `ensureInitialized()` without `await`; init errors (Docker pull failure, container system failure) are silently swallowed — only logged, not propagated. |
| `CodeSandboxPlugin` | Security | Low | `input_data` is passed as `-e INPUT_DATA=...` environment variable; at the 256KB maximum, system `execve` limits may cause silent failure or truncation. |
| `SubAgentPlugin` | Concurrency | Medium | `onActivityReset` is an instance field overwritten per `executeTool` call; concurrent calls on the same instance corrupt inactivity tracking. Documented but not structurally prevented. |
| `SubAgentPlugin` | Error handling | Medium | Timeout rejection is an uncaught throw from `executeTool`; `BaseAgent` swallows it and the LLM sees no tool result. |
