# 2b

A modular AI agent framework built with Bun. Features a plugin-based architecture, persistent semantic memory, and a rich tool set — designed to run against a local LLM via LM Studio.

## Requirements

- [Bun](https://bun.sh) v1.3.9+
- [LM Studio](https://lmstudio.ai) running locally (default: `http://127.0.0.1:1234`)
- A model loaded in LM Studio (default: `nvidia/nemotron-3-nano-4b`)

Optional:
- Docker or Apple Container (macOS) — for `CodeSandboxPlugin` (isolated Python execution)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) in PATH — for `YtDlpPlugin` (video clip downloads)
- [ffmpeg](https://ffmpeg.org) in PATH — for `FFmpegPlugin` (video editing)
- TMDB API key — for movie/people lookup tools

## Setup

```bash
bun install
cp .env.dev .env
# edit .env to set MODEL, TMDB_API_KEY, etc.
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

The framework is built around a central `BaseAgent` event loop that orchestrates plugins, manages input queues, assembles system prompts, and calls the LLM.

```
index.ts
  └── AgentFactory → CortexAgent (wraps BaseAgent)
        ├── Plugins (memory, tools, I/O, APIs)
        ├── InputSources (CLI)
        └── LMStudioProvider (LLM backend)
```

**Input queues** — `BaseAgent` maintains two queues:
- **Direct** — requires a response
- **Ambient** — background context; agent can reply `[IGNORE]` to skip

Each tick, the agent collects history and context from plugins, assembles a fresh system prompt, calls the LLM, and emits the response via a `"speak"` event.

## Plugins

Plugins implement the `AgentPlugin` interface and can contribute system prompt fragments, per-turn context, tool definitions, and lifecycle hooks.

| Plugin | Description |
|--------|-------------|
| `CortexMemoryPlugin` | Persistent semantic memory (factual / thought / behavior / procedure types) with embedding-based search — auto-registered by `CortexAgent` |
| `ThoughtPlugin` | Auto-captures `<think>` reasoning blocks as memory — auto-registered by `CortexAgent` |
| `MemoryPlugin` | Short-term conversation history (max 15 messages, auto-summarize) |
| `TMDBPlugin` | Movie and people lookup via TMDB API |
| `FileIOPlugin` | File read/write/download tools (HTTPS downloads, local filesystem) |
| `ImageVisionPlugin` | Image analysis via local vision model (LM Studio) |
| `WebSearchPlugin` | Web search via DuckDuckGo instant answers |
| `WebReaderPlugin` | Fetch and extract readable content from web pages |
| `ShellPlugin` | Read-only shell command execution (ls, git, cat, grep, etc.) |
| `ClipboardPlugin` | macOS clipboard read/write |
| `NotesPlugin` | Persistent markdown notes |
| `WeatherPlugin` | Current weather via Open-Meteo (no API key required) |
| `YtDlpPlugin` | Download video clips from Twitch, YouTube, etc. via yt-dlp |
| `FFmpegPlugin` | Video editing: trim, convert, crop, resize, extract audio, and more |
| `CodeSandboxPlugin` | Execute Python 3.11 in an isolated container; a coding model generates the code from a plain-language task description |
| `MinimalToolsPlugin` | Inline tools: `get_current_time`, `calculate`, `echo` |

## Memory

Long-term memory is stored in SQLite under `data/`. The `CortexMemory` system stores embeddings alongside text and supports semantic retrieval via cosine similarity.

Four memory types:
- **factual** — specific facts and decisions
- **thought** — internal reasoning (auto-captured from `<think>` tags)
- **behavior** — persistent behavioral rules injected into the system prompt every turn
- **procedure** — step-by-step instructions for tasks the agent has previously solved

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL` | `nvidia/nemotron-3-nano-4b` | Model name as shown in LM Studio |
| `LM_STUDIO_URL` | `http://127.0.0.1:1234` | LM Studio base URL |
| `CODE_MODEL` | `qwen2.5-coder-7b-instruct-mlx` | Model used by `CodeSandboxPlugin` to generate Python |
| `TMDB_API_KEY` | — | Required for `TMDBPlugin` |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR` / `OFF` |

## Extending

**Add a plugin** — implement `AgentPlugin` and register it in `src/agents/AgentFactory.ts`.

**Add a tool** — define a JSON Schema tool in your plugin's `getTools()` method and handle it in `executeTool()`.

**Swap the LLM backend** — implement `LLMProvider` (see `src/providers/llm/LLMProvider.ts`) and pass it to `BaseAgent`.
