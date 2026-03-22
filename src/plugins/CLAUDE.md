# Plugins

Modular agent capabilities. Each plugin implements `AgentPlugin` from `../core/Plugin.ts` and is injected into a `BaseAgent` via `agent.registerPlugin(plugin)`.

## Plugin Lifecycle

| Hook | When called | Typical use |
|------|------------|-------------|
| `onInit(agent)` | Once, when agent starts | Subscribe to agent events, store agent ref |
| `getSystemPromptFragment()` | Every LLM call | Inject static instructions into system prompt |
| `getContext(events?)` | Every LLM call | Inject dynamic context (time, memory hits, etc.) |
| `getTools()` | Every LLM call | Expose callable tools |
| `executeTool(name, args)` | When LLM invokes a tool | Run tool implementation |
| `onMessage(role, content, source)` | Every message | Log, store, or react to messages |
| `getMessages(limit?)` | History replay | Return conversation history |
| `augmentResponse(response)` | After LLM response, before emit | Transform or reroute the response string |

## Available Plugins

| Plugin | Purpose |
|--------|---------|
| `CortexMemoryPlugin` | Long-term memory with types (factual/thought/behavior), semantic search, linking, deletion, and autonomous conflict resolution — auto-registered by `CortexAgent` |
| `ThoughtPlugin` | Persists `<think>` blocks as thought memories; exposes `get_recent_thoughts` — auto-registered by `CortexAgent` |
| `MemoryPlugin` | Short-term conversation history (max 15 messages, auto-summarises) |
| `AudioPlugin` | Classifies microphone speech as direct/ambient via intent detection |
| `TimePlugin` | Injects current time into context; exposes `get_current_time` tool |
| `TMDBPlugin` | Movie and people lookup via The Movie Database API; tools: `search_movies`, `get_movie_details`, `get_movie_credits`, `get_movie_recommendations`, `get_trending_movies`, `search_person`, `get_person_details`; requires `TMDB_API_KEY` |
| `FileIOPlugin` | Local filesystem read/write and HTTPS file downloads; tools: `download_file` (URL → `downloads/`, max 100 MB), `read_file` (text content, max 1 MB), `write_file` (create/overwrite), `list_directory` — all local paths restricted to working directory |
| `ImageVisionPlugin` | Image analysis via a local vision model; tools: `analyze_image_url` (from web URL) and `analyze_image_file` (from local path) |
| `YtDlpPlugin` | Download video clips from Twitch VODs, YouTube, and other yt-dlp-compatible sites; tool: `download_video_clip` (url, start_time, end_time) — requires `yt-dlp` in PATH |
| `RSSPlugin` | Fetch and parse RSS and Atom feeds (HTTPS only); tool: `fetch_rss_feed` (url, limit) — returns feed title, description, and items with title, link, description, pubDate, author |
| `WebSearchPlugin` | DuckDuckGo instant answers for factual queries; tool: `web_search` |
| `WebReaderPlugin` | Fetches and extracts readable article text from HTTPS web pages; tool: `read_webpage` |
| `ShellPlugin` | Read-only shell command execution (ls, git, cat, grep, etc.); tool: `run_shell` — no shell operators, no write commands |
| `ClipboardPlugin` | macOS clipboard read/write via pbpaste/pbcopy; tools: `read_clipboard`, `write_clipboard` |
| `NotesPlugin` | Persistent markdown notes saved to `notes/` directory; tools: `create_note`, `list_notes`, `read_note`, `delete_note` |
| `WeatherPlugin` | Current weather conditions via Open-Meteo (no API key required); tool: `get_weather` (location) |
| `CodeSandboxPlugin` | Executes Python 3.11 snippets in an isolated Docker container (`python:3.11-slim`); tool: `execute_code` (code, optional input_data JSON, optional timeout_ms) — no network, no host fs, memory/cpu/pids limited, stdout/stderr captured, 15s default timeout, 60s max; pre-pulls image on init |

## Writing a New Plugin

1. Create a class implementing `AgentPlugin`
2. Only implement the hooks you actually need
3. If exposing tools, define them in `getTools()` and handle in `executeTool()`
4. Register in the relevant factory function

```typescript
import type { AgentPlugin } from "../core/Plugin.ts";

export class MyPlugin implements AgentPlugin {
  name = "MyPlugin";

  getSystemPromptFragment() {
    return "You have access to my_plugin capabilities.";
  }

  getTools() {
    return [{
      name: "my_tool",
      description: "Does something useful",
      parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
    }];
  }

  async executeTool(name: string, args: any) {
    if (name === "my_tool") return doSomething(args.input);
    // Return undefined (not throw) for unknown names so other plugins can handle them
  }
}
```

## Conventions
- Plugin constructors must not do I/O — defer setup to `onInit`
- Return `undefined` (not throw) from `executeTool` for unknown tool names so other plugins can handle them
- Keep plugin responsibilities narrow — compose multiple small plugins rather than one large one
- Use `../logger.ts` for logging — never `console.log` except for fatal errors
- If the plugin needs SQLite, use `bun:sqlite` directly — see `CortexMemoryDatabase.ts` for reference
