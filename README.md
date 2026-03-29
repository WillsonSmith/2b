# 2b

A modular AI agent framework built with Bun. Features a plugin-based architecture, persistent semantic memory, and a rich tool set — designed to run against a local LLM via LM Studio.

## Requirements

- [Bun](https://bun.sh) v1.3.9+
- [LM Studio](https://lmstudio.ai) running locally with a model loaded (default: `nvidia/nemotron-3-nano-4b`)

Optional (enables specific plugins):
- [ffmpeg](https://ffmpeg.org) in PATH — `FFmpegPlugin`, `YtDlpPlugin`, microphone input
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) in PATH — `YtDlpPlugin` (video clip downloads)
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) server — microphone transcription
- Docker or Apple Container (macOS) — `CodeSandboxPlugin` (isolated Python execution)
- TMDB API key — `TMDBPlugin` (movie/people lookup)

## Setup

```bash
bun install
```

The agent will run without a `.env` file using defaults. To customise, create a `.env` at the project root:

```bash
MODEL=your-model-name
LM_STUDIO_URL=ws://127.0.0.1:1234
TMDB_API_KEY=your_key_here
```

## Running

```bash
bun run index.ts
```

**One-shot mode** — pass a message as an argument or pipe stdin:

```bash
bun run index.ts "what time is it?"
echo "summarize this" | bun run index.ts --quiet
cat error.log | bun run index.ts "explain this error"
```

**Flags:**

| Flag | Description |
|------|-------------|
| `-m, --model <name>` | Override the model (e.g. `qwen3:8b`) |
| `-q, --quiet` | Output response text only, no labels or colors |
| `--no-reasoning` | Suppress `<think>` reasoning output |
| `-t, --tools` | Print tool calls to stderr as they happen |
| `-h, --help` | Show help |

**Memory subcommands:**

```bash
bun run index.ts memory list
bun run index.ts memory search <query>
bun run index.ts memory clear
```

With debug logging:

```bash
LOG_LEVEL=DEBUG bun run index.ts
```

## Architecture

```
index.ts
  └── AgentFactory → CortexAgent (wraps BaseAgent + memory)
        ├── Sub-agents (via SubAgentPlugin)
        │     ├── media_agent  → HeadlessAgent [YtDlp, FFmpeg, ImageVision]
        │     ├── web_agent    → HeadlessAgent [WebSearch, WebReader, Wikipedia, RSS]
        │     ├── system_agent → HeadlessAgent [Shell, FileIO, Clipboard, CodeSandbox]
        │     └── info_agent   → HeadlessAgent [TMDB, Weather, Notes]
        ├── MemoryPlugin (short-term conversation history)
        ├── MinimalTools (get_current_time, echo)
        ├── CLIInputSource
        └── LMStudioProvider (LLM backend)
```

The central `BaseAgent` manages two input queues:

- **Direct** — requires a response (`addDirect()`)
- **Ambient** — background context; agent can reply `[IGNORE]` to skip (`addAmbient()`)

Each tick, the agent collects history and context from all plugins, assembles a fresh system prompt, calls the LLM, and emits the response via a `"speak"` event.

**`CortexAgent`** wraps `BaseAgent` and automatically registers `CortexMemoryPlugin` (long-term semantic memory) and `ThoughtPlugin` (reasoning capture).

**Sub-agents** are domain-specific `HeadlessAgent` instances registered as single tools on the orchestrator via `SubAgentPlugin`. The orchestrator routes tasks to the appropriate sub-agent; sub-agent tool calls are surfaced on the parent's `tool_call` event.

## Plugins

Plugins implement the `AgentPlugin` interface and contribute system prompt fragments, per-turn context, tool definitions, and lifecycle hooks. All hooks are optional — implement only what you need.

| Plugin | Description |
|--------|-------------|
| `CortexMemoryPlugin` | Persistent semantic memory with embedding-based search — auto-registered by `CortexAgent`; tools: `search_memory`, `save_memory`, `save_behavior`, `save_procedure`, `edit_memory`, `delete_memory`, and more |
| `ThoughtPlugin` | Auto-captures `<think>` reasoning blocks as thought memories — auto-registered by `CortexAgent` |
| `MemoryPlugin` | Short-term conversation history (max 15 messages, auto-summarize) |
| `SubAgentPlugin` | Wraps a `HeadlessAgent` as a single callable tool on the orchestrator |
| `FileIOPlugin` | File read/write/download tools (HTTPS downloads capped at 100 MB, local paths restricted to cwd) |
| `ImageVisionPlugin` | Image analysis via a local vision model; tools: `analyze_image_url`, `analyze_image_file` |
| `WebSearchPlugin` | Web search via DuckDuckGo instant answers |
| `WebReaderPlugin` | Fetch and extract readable content from HTTPS pages |
| `WikipediaPlugin` | Search and fetch Wikipedia articles (no API key required) |
| `RSSPlugin` | Fetch and parse RSS/Atom feeds |
| `TMDBPlugin` | Movie and people lookup via TMDB API; requires `TMDB_API_KEY` |
| `WeatherPlugin` | Current weather via Open-Meteo (no API key required) |
| `NotesPlugin` | Persistent markdown notes saved to `notes/` |
| `ShellPlugin` | Read-only shell command execution (ls, git, cat, grep, etc.) |
| `ClipboardPlugin` | macOS clipboard read/write |
| `YtDlpPlugin` | Download video clips from Twitch, YouTube, etc. via yt-dlp |
| `FFmpegPlugin` | Video editing: trim, convert, crop, resize, extract audio, merge, and more |
| `CodeSandboxPlugin` | Execute Python 3.11 in an isolated container; a coding model generates code from a plain-language task description |
| `AudioPlugin` | Classifies microphone speech as direct/ambient via intent detection |

## Memory

Long-term memory is stored in SQLite at `~/.local/share/2b/data/2b.cortex.sqlite` (respects `XDG_DATA_HOME`). The `CortexMemory` system stores embeddings alongside text and retrieves relevant memories via cosine similarity on each turn.

Four memory types:
- **factual** — specific facts and decisions
- **thought** — internal reasoning (auto-captured from `<think>` blocks)
- **behavior** — persistent behavioral rules injected into the system prompt every turn
- **procedure** — step-by-step instructions for recurring tasks

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL` | `nvidia/nemotron-3-nano-4b` | Chat model name as shown in LM Studio |
| `LM_STUDIO_URL` | `ws://127.0.0.1:1234` | LM Studio WebSocket endpoint |
| `CODE_MODEL` | `qwen2.5-coder-7b-instruct-mlx` | Model used by `CodeSandboxPlugin` to generate Python |
| `VISION_MODEL` | `google/gemma-3-4b` | Model used by `ImageVisionPlugin` for image analysis |
| `WHISPER_ENDPOINT` | `http://localhost:8080/inference` | whisper.cpp HTTP endpoint for microphone transcription |
| `TMDB_API_KEY` | — | Required for `TMDBPlugin` |
| `LOG_LEVEL` | `OFF` | `DEBUG` / `INFO` / `WARN` / `ERROR` / `OFF` |

## Extending

**Add a plugin** — implement `AgentPlugin` (see `src/plugins/CLAUDE.md` for the full lifecycle reference) and register it in `src/agents/AgentFactory.ts`.

**Add a sub-agent** — create a factory in `src/agents/sub-agents/`, then register it via `SubAgentPlugin` in `AgentFactory.ts`. See `src/agents/sub-agents/CLAUDE.md`.

**Swap the LLM backend** — implement `LLMProvider` from `src/providers/llm/LLMProvider.ts` and pass it to `BaseAgent` or `CortexAgent`.

## Testing

```bash
bun test
```

Tests use `bun:test`. Memory tests pass `:memory:` as the `memoryDbPath` to avoid touching the filesystem.
