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
| `CortexMemoryPlugin` | Long-term memory with types (factual/thought/behavior/procedure), semantic search, linking, editing, deletion, and autonomous conflict resolution; auto-surfaces relevant memories in context each turn — auto-registered by `CortexAgent`; tools: `search_memory`, `save_memory`, `save_behavior`, `save_procedure`, `edit_memory`, `delete_memory`, `get_linked_memories`, `query_memories`, `hybrid_search`, `aggregate_memories`, `get_memory_timeline` |
| `ThoughtPlugin` | Persists `<think>` blocks as thought memories; exposes `get_recent_thoughts` — auto-registered by `CortexAgent` |
| `SourceReaderPlugin` | Read-only access to the agent's own source code; tools: `read_source_file` (read file by project-relative path, max 500 KB), `list_source_dir` (browse directory tree), `grep_source` (ripgrep search, defaults to `src/**/*.ts`, max 5 matches per file); all paths sandboxed to `sourceRoot` (constructor option, defaults to `process.cwd()`); used by `createCodebaseExplainerAgent` (`explore_codebase` sub-agent) |
| `MetacognitionPlugin` | Tracks per-turn cognitive state — auto-registered by `CortexAgent` (last, so it observes all other plugins); **cognitive state tools:** `introspect` (full turn state dump), `memory_status` (counts by type + saturation info), `show_active_rules` (all behavior memories); **runtime inspection tools:** `list_registered_plugins` (active plugins + tool counts), `list_available_tools` (all callable tools + descriptions), `get_system_prompt` (assembled system prompt from last LLM call); injects `[Metacognition]` context block every LLM call; detects tool saturation (configurable threshold, default 5) and hedged language in assistant responses |
| `MemoryPlugin` | Short-term conversation history (max 15 messages, auto-summarises) |
| `TMDBPlugin` | Movie and people lookup via The Movie Database API; tools: `search_movies`, `get_movie_details`, `get_movie_credits`, `get_movie_recommendations`, `get_trending_movies`, `search_person`, `get_person_details`; requires `TMDB_API_KEY` |
| `FileSystemPlugin` | Local filesystem access; tools: `read_file` (text, max 1 MB, with offset/limit paging), `write_file` (create/overwrite), `append_file`, `list_directory`, `move_file`, `copy_file`, `delete_file`, `make_directory`, `stat_file` (metadata), `find_files` (glob search) — all paths restricted to working directory |
| `DownloadPlugin` | HTTPS file downloads; tool: `download_file` (URL → `downloads/`, max 100 MB) — blocks private/internal addresses |
| `ImageVisionPlugin` | Image analysis via a local vision model; tools: `analyze_image_url` (from web URL) and `analyze_image_file` (from local path) |
| `YtDlpPlugin` | Download video clips from Twitch VODs, YouTube, and other yt-dlp-compatible sites; tool: `download_video_clip` (url, start_time, end_time) — requires `yt-dlp` in PATH |
| `FFmpegPlugin` | Edit local video files via FFmpeg; tools: `ffmpeg_get_info` (metadata), `ffmpeg_trim` (cut by timestamps), `ffmpeg_convert` (format/codec), `ffmpeg_extract_audio` (rip audio), `ffmpeg_resize` (scale), `ffmpeg_concatenate` (join files), `ffmpeg_images_to_video` (create video from image sequence), `ffmpeg_add_audio` (mux audio track), `ffmpeg_extract_frames` (dump frames as images), `ffmpeg_screenshot` (single frame at timestamp), `ffmpeg_crop` (crop region), `ffmpeg_speed` (change playback speed), `ffmpeg_rotate` (rotate/flip) — requires `ffmpeg` and `ffprobe` in PATH |
| `RSSPlugin` | Fetch and parse RSS and Atom feeds (HTTPS only); tool: `fetch_rss_feed` (url, limit) — returns feed title, description, and items with title, link, description, pubDate, author |
| `WebSearchPlugin` | DuckDuckGo instant answers for factual queries; tool: `web_search` |
| `WebReaderPlugin` | Fetches and extracts readable article text from HTTPS web pages; tool: `read_webpage` |
| `WikipediaPlugin` | Search and fetch Wikipedia articles (no API key required); tools: `wikipedia_search` (query → titles + snippets), `wikipedia_get_article` (title → short summary + URL), `wikipedia_list_sections` (title → table of contents), `wikipedia_get_section` (title + section_index → plain-text section content, max_chars cap), `wikipedia_get_links` (title + optional section_index → internal Wikipedia links with article titles, for following related topics) |
| `ShellPlugin` | Read-only shell command execution (ls, git, cat, grep, etc.); tool: `run_shell` — no shell operators, no write commands |
| `ScratchPlugin` | Session-scoped scratch pad in the OS temp directory (`/tmp/agent-{sessionId}/`); AI saves content it may need verbatim in future turns before the context window can summarize it away; tools: `scratch_write` (save by name, max 1 MB), `scratch_read` (retrieve full text), `scratch_list` (index with sizes), `scratch_delete` (remove); directory auto-cleaned by OS; `getContext()` injects the current file index every turn so the list survives summarization; pass `sessionId` to constructor for predictable paths (useful in tests) |
| `ClipboardPlugin` | macOS clipboard read/write via pbpaste/pbcopy; tools: `read_clipboard`, `write_clipboard` |
| `NotesPlugin` | Persistent markdown notes saved to `notes/` directory; tools: `create_note`, `list_notes`, `read_note`, `delete_note` |
| `WeatherPlugin` | Current weather conditions via Open-Meteo (no API key required); tool: `get_weather` (location) |
| `SubAgentPlugin` | Wraps a `HeadlessAgent` as a single tool on the orchestrator; constructor options: `toolName`, `description`, `agent`, optional `inactivityTimeoutMs` (resets on each tool call), optional `absoluteTimeoutMs` (hard cap); sub-agent tool calls are forwarded to the parent agent's `subagent_tool_call` event via `setToolCallHandler` |
| `DynamicAgentPlugin` | Allows the orchestrator to spawn and call sub-agents at runtime; tools: `create_agent` (name, system_prompt, agent_type, capabilities[]), `call_agent` (name, task), `list_agents`, `list_capabilities`; supports `"headless"` (stateless, `HeadlessAgent` + `InMemoryDatabasePlugin` + capability plugins) and `"cortex"` (persistent, `CortexSubAgent` with full memory) types; accepts `presets` constructor option to pre-create headless agents at init; emits `agent_spawned`, `agent_state_change`, `agent_error` on the parent agent |
| `InMemoryDatabasePlugin` | Session-scoped key-value store for headless agents; tools: `agent_memory_set`, `agent_memory_get`, `agent_memory_delete`, `agent_memory_list`; always included in headless agents created by `DynamicAgentPlugin` |

## Writing a New Plugin

1. Create a class implementing `AgentPlugin`
2. Only implement the hooks you actually need
3. If exposing tools, define them in `getTools()` and handle in `executeTool()`
4. Register in `2b.ts` or add as a capability in `DynamicAgentPlugin`'s `CAPABILITY_REGISTRY`

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
