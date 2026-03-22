# 2b

A modular AI agent framework built with Bun. Features a plugin-based architecture, persistent semantic memory, and multi-modal input — designed to run against a local LLM via LM Studio.

## Requirements

- [Bun](https://bun.sh) v1.3.9+
- [LM Studio](https://lmstudio.ai) running locally on `http://127.0.0.1:1234`
- A model loaded in LM Studio (default: `nvidia/nemotron-3-nano-4b`)

Optional:
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) server on `http://localhost:8080` — for microphone input / speech-to-text
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
        ├── InputSources (CLI, microphone)
        └── LMStudioProvider (LLM backend)
```

**Input queues** — `BaseAgent` maintains two queues:
- **Direct** — requires a response
- **Ambient** — background context; agent can reply `[IGNORE]` to skip

Each tick (3s heartbeat), the agent collects history and context from plugins, assembles a fresh system prompt, calls the LLM, and emits the response via a `"speak"` event.

## Plugins

Plugins implement the `AgentPlugin` interface and can contribute:
- System prompt fragments
- Conversation context (injected each tick)
- Tool definitions (exposed to the LLM)
- Hooks on agent lifecycle events

| Plugin | Description |
|--------|-------------|
| `CortexMemoryPlugin` | Persistent semantic memory (factual / thought / behavior types) with cosine-similarity search |
| `ThoughtPlugin` | Auto-captures `<think>` reasoning blocks as memory |
| `MemoryPlugin` | Short-term conversation history (max 15 messages, auto-summarize) |
| `DocumentManagerPlugin` | Full document lifecycle: create, edit, version, link, semantic search |
| `TMDBPlugin` | Movie and people lookup via TMDB API |
| `FileIOPlugin` | File read/write/download tools |
| `ImageVisionPlugin` | Image analysis via local vision model |
| `AudioPlugin` | Microphone input with voice activity detection and intent classification |
| `TimePlugin` | Injects current time into system prompt |

## Memory

Long-term memory is stored in SQLite under `data/`. The `CortexMemory` system stores embeddings alongside text and supports semantic retrieval via cosine similarity.

Three memory types:
- **factual** — specific facts and decisions
- **thought** — internal reasoning (auto-captured from `<think>` tags)
- **behavior** — persistent behavioral rules

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL` | `nvidia/nemotron-3-nano-4b` | Model name as shown in LM Studio |
| `LOG_LEVEL` | `INFO` | `DEBUG` / `INFO` / `WARN` / `ERROR` / `OFF` |
| `TMDB_API_KEY` | — | Optional; enables movie lookup tools |

## Extending

**Add a plugin** — implement `AgentPlugin` and register it in `src/agents/AgentFactory.ts`.

**Add a tool** — define a Zod-typed tool in your plugin's `getTools()` method and handle it in `handleToolCall()`.

**Swap the LLM backend** — implement `LLMProvider` (see `src/providers/llm/LLMProvider.ts`) and pass it to `BaseAgent`.
