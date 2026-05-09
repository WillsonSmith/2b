# 2b

A modular AI agent framework and application suite built with Bun. Features a plugin-based architecture, persistent semantic memory, and a rich tool set — designed to run against a local LLM via LM Studio or Ollama.

## Packages

This is a Bun workspace monorepo with four packages:

| Package | Description |
|---------|-------------|
| `@2b/framework` | Shared AI framework — agents, plugins, providers, memory |
| `@2b/app` | 2b chat agent — terminal UI, web UI |
| `@2b/episteme` | Episteme — AI-powered Markdown research editor |
| `@2b/electron-shell` | Electron desktop wrapper for Episteme |

## Requirements

- [Bun](https://bun.sh) v1.3.9+
- [LM Studio](https://lmstudio.ai) running locally with a model loaded, **or** [Ollama](https://ollama.com) with a model pulled

Optional (enables specific plugins):
- [ffmpeg](https://ffmpeg.org) in PATH — `FFmpegPlugin`, `YtDlpPlugin`, microphone input
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) in PATH — `YtDlpPlugin` (video clip downloads)
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) server — microphone transcription
- Docker or Apple Container (macOS) — `BunSandboxPlugin` (isolated code execution)
- TMDB API key — `TMDBPlugin` (movie/people lookup)

## Setup

```bash
bun install
```

All workspace packages are installed in one step. To customise behaviour, create a `.env` at the project root:

```bash
MODEL=your-model-name
LM_STUDIO_URL=ws://127.0.0.1:1234
TMDB_API_KEY=your_key_here
```

## Running

**2b chat agent** — terminal UI:
```bash
bun run 2b
```

Override model or switch to web UI:
```bash
bun run 2b -- --model google/gemma-4-27b
bun run 2b -- --web
bun run 2b -- --web --port 8080
```

**Memory subcommands:**
```bash
bun run 2b -- memory list
bun run 2b -- memory search <query>
bun run 2b -- memory clear
```

**Episteme editor** — browser:
```bash
bun run episteme ~/your-notes-folder
bun run episteme -- --port 4001 ~/your-notes-folder
```

**Episteme editor** — desktop app:
```bash
bun run electron
```

**Debug logging:**
```bash
LOG_LEVEL=DEBUG bun run 2b
```

**Tests:**
```bash
bun test
```

## Architecture

### Framework (`@2b/framework`)

The framework is a standalone package consumed by both applications. It has no knowledge of either app's UI or entry point.

```
packages/framework/src/
  core/        — BaseAgent, CortexAgent, HeadlessAgent, Plugin interface, PermissionManager
  plugins/     — Full plugin catalog (30+ plugins)
  providers/   — LLMProvider interface, LMStudioProvider, OllamaProvider
  agents/      — Sub-agent factories and utilities
  memory/      — Legacy MemoryProvider interface
  utils/       — deviceSelector, stream-tts
  paths.ts     — XDG data directory resolution
  logger.ts    — Shared structured logger
```

### 2b Agent (`@2b/app`)

```
packages/app-2b/
  2b.ts        — Entry point: wires agent + plugins + UI
  src/
    cli/       — memory-cmd subcommand
    ui/
      terminal/ — Ink-based terminal chat UI
      web/      — Bun HTTP + WebSocket web UI
```

**Agent topology:**
```
CortexAgent
  ├── CortexMemoryPlugin   (auto — long-term semantic memory)
  ├── ThoughtPlugin        (auto — captures <think> blocks)
  ├── MetacognitionPlugin  (auto — cognitive state tracking)
  ├── DynamicAgentPlugin   (create_agent, call_agent, list_agents)
  │     ├── preset: media  → HeadlessAgent [YtDlp, FFmpeg, ImageVision, Download]
  │     └── preset: info   → HeadlessAgent [TMDB, Weather, Wikipedia, RSS]
  ├── explore_codebase     → SubAgentPlugin [CodebaseExplainerAgent]
  ├── FileSystemPlugin     (sandboxed to cwd)
  ├── ShellPlugin          (read-only shell commands)
  ├── ScratchPlugin        (session scratch pad)
  ├── BehaviorPlugin       (persistent behavioral rules)
  ├── MemoryPlugin         (short-term conversation history)
  └── LMStudioProvider / OllamaProvider
```

### Episteme Editor (`@2b/episteme`)

AI-powered Markdown research editor with a Bun HTTP server and a React/Tiptap frontend.

```
packages/app-episteme/
  episteme.ts   — Entry point: starts Bun server
  src/
    agent.ts    — CortexAgent wired with Episteme-specific plugins
    server/     — Bun.serve() routes + WebSocket handlers
    components/ — React frontend (editor, panels, graph)
    plugins/    — Episteme-specific plugins (Workspace, Research, Diagram, Citation, ...)
    features/   — Headless AI features (autocomplete, lint, summarize, ...)
    hooks/      — React hooks
    shell/      — IShell interface + BrowserShell / ElectronShell implementations
    db/         — WorkspaceDb (SQLite via bun:sqlite)
    electron/   — @2b/electron-shell: Electron main process + preload
```

## Plugins

Plugins implement the `AgentPlugin` interface from `@2b/framework/core/Plugin.ts` and are registered via `agent.registerPlugin(plugin)`.

| Plugin | Description |
|--------|-------------|
| `CortexMemoryPlugin` | Persistent semantic memory — embedding search, factual/thought/behavior/procedure types; auto-registered by `CortexAgent` |
| `ThoughtPlugin` | Auto-captures `<think>` reasoning blocks as thought memories; auto-registered by `CortexAgent` |
| `MetacognitionPlugin` | Cognitive state tracking, tool saturation detection, runtime inspection tools; auto-registered by `CortexAgent` |
| `MemoryPlugin` | Short-term conversation history (max 15 messages, auto-summarise) |
| `DynamicAgentPlugin` | Spawn and call sub-agents at runtime; preset agents (`media`, `info`) at startup |
| `SubAgentPlugin` | Wraps a `HeadlessAgent` as a single callable tool on the orchestrator |
| `BehaviorPlugin` | Persistent behavioral rules synced from `CortexMemoryPlugin` |
| `FileSystemPlugin` | File read/write/copy/move/delete — sandboxed to allowed roots |
| `ShellPlugin` | Read-only shell commands (ls, git, cat, grep, etc.) |
| `ScratchPlugin` | Session-scoped scratch pad in `/tmp/agent-{sessionId}/` |
| `ImageVisionPlugin` | Image analysis via a local vision model |
| `WebSearchPlugin` | Web search via DuckDuckGo instant answers |
| `WebReaderPlugin` | Fetch and extract readable content from HTTPS pages |
| `WikipediaPlugin` | Search and fetch Wikipedia articles |
| `RSSPlugin` | Fetch and parse RSS/Atom feeds |
| `TMDBPlugin` | Movie and people lookup via TMDB API; requires `TMDB_API_KEY` |
| `WeatherPlugin` | Current weather via Open-Meteo (no API key required) |
| `NotesPlugin` | Persistent markdown notes saved to `notes/` |
| `ClipboardPlugin` | macOS clipboard read/write |
| `YtDlpPlugin` | Download video clips via yt-dlp |
| `FFmpegPlugin` | Video editing: trim, convert, crop, resize, extract audio, merge, and more |
| `DownloadPlugin` | HTTPS file downloads (max 100 MB) |
| `BunSandboxPlugin` | Execute code in an isolated Bun sandbox |

## Memory

Long-term memory is stored in SQLite at `~/.local/share/2b/data/2b.cortex.sqlite` (respects `XDG_DATA_HOME`). The `CortexMemory` system stores embeddings alongside text and retrieves relevant memories via cosine similarity each turn.

Four memory types:
- **factual** — specific facts and decisions
- **thought** — internal reasoning (auto-captured from `<think>` blocks)
- **behavior** — persistent behavioral rules injected into the system prompt every turn
- **procedure** — step-by-step instructions for recurring tasks

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL` | provider default | Chat model name |
| `PROVIDER` | `lmstudio` | `lmstudio` or `ollama` |
| `LM_STUDIO_URL` | `ws://127.0.0.1:1234` | LM Studio WebSocket endpoint |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama HTTP endpoint |
| `VISION_MODEL` | `google/gemma-3-4b` | Model used by `ImageVisionPlugin` |
| `WHISPER_ENDPOINT` | `http://localhost:8080/inference` | whisper.cpp endpoint for microphone transcription |
| `TMDB_API_KEY` | — | Required for `TMDBPlugin` |
| `LOG_LEVEL` | `OFF` | `DEBUG` / `INFO` / `WARN` / `ERROR` / `OFF` |

## Extending

**Add a plugin** — implement `AgentPlugin` from `@2b/framework/core/Plugin.ts` (see `packages/framework/src/plugins/CLAUDE.md` for the full lifecycle reference) and register it in `packages/app-2b/2b.ts`.

**Add a capability** — add a new entry to the capability registry in `DynamicAgentPlugin` so the agent can include it when spawning runtime sub-agents.

**Add a preset sub-agent** — add an entry to the `presets` map in `DynamicAgentPlugin` in `packages/app-2b/2b.ts`.

**Add a static sub-agent** (when it needs its own LLM or specialised setup) — create a factory in `packages/framework/src/agents/sub-agents/`, then register it via `SubAgentPlugin` in `packages/app-2b/2b.ts`. See `packages/framework/src/agents/sub-agents/CLAUDE.md`.

**Swap the LLM backend** — implement `LLMProvider` from `@2b/framework/providers/llm/LLMProvider.ts` and pass it to `BaseAgent` or `CortexAgent`.

## Testing

```bash
bun test
```

Tests use `bun:test` and run across all workspace packages from the repo root. Memory tests pass `:memory:` as the `memoryDbPath` to avoid touching the filesystem.
