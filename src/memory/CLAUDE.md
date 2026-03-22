# Memory

This directory contains low-level conversation history providers. These are **not** the long-term semantic memory system — see `src/plugins/CortexMemoryPlugin.ts` for that.

## Purpose

`MemoryProvider` is used by `MemoryPlugin` to store and replay short-term conversation history across turns. It supplies the sliding-window message history injected into each LLM call.

## Interface

`MemoryProvider` defines:
- `addMessage(role, content, interactionType?)` — store a message with its role and interaction type
- `getRecentContext(limit?)` — retrieve recent messages as a formatted string
- `getRecentMessages(limit?)` — retrieve recent messages as an array for chat APIs (role/content objects)

`MemoryItem` tracks: `id`, `role` (`user | agent | assistant | system`), `content`, `interactionType` (e.g. `direct`, `overheard`, `vision`), `timestamp`.

## Implementations

| File | Backend | Notes |
|------|---------|-------|
| `SQLiteMemoryProvider.ts` | SQLite (`bun:sqlite`) | Persistent across restarts; default db path `./vision-ai.db` |

## Relation to CortexMemoryPlugin

`MemoryProvider` / `SQLiteMemoryProvider` handle **short-term** conversation history (what was said recently).

`CortexMemoryPlugin` (in `src/plugins/`) handles **long-term** semantic memory — embedding-based search, factual/thought/behavior types, and cross-session recall. It uses `IMemoryDatabase` / `CortexMemoryDatabase` as its backend, not `MemoryProvider`.

## Adding a New Backend

Implement the `MemoryProvider` interface and pass it to `MemoryPlugin`.
