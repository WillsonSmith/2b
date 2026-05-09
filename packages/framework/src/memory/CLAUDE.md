# Memory

This directory contains low-level conversation history abstractions. These are **not** the long-term semantic memory system — see `src/plugins/CortexMemoryPlugin.ts` for that.

## Current State

`MemoryProvider.ts` defines a legacy interface (`MemoryProvider`, `MemoryItem`, `MemoryQuery`) that is **not currently used** by any plugin or agent. It is retained as a reference for future backends.

Short-term conversation history is handled directly by `MemoryPlugin` (`src/plugins/MemoryPlugin.ts`), which stores messages in an in-memory array and auto-summarises when the count exceeds 15. It does not use the `MemoryProvider` interface.

## Interface (MemoryProvider.ts)

`MemoryProvider` defines:
- `addMessage(role, content, interactionType?)` — store a message with its role and interaction type
- `getRecentContext(limit?)` — retrieve recent messages as a formatted string
- `getRecentMessages(limit?)` — retrieve recent messages as an array for chat APIs (role/content objects)

`MemoryItem` tracks: `id`, `role` (`user | agent | assistant | system`), `content`, `interactionType` (e.g. `direct`, `overheard`, `vision`), `timestamp`.

## Relation to CortexMemoryPlugin

`MemoryPlugin` handles **short-term** conversation history (what was said recently, max 15 messages, auto-summarised).

`CortexMemoryPlugin` (in `src/plugins/`) handles **long-term** semantic memory — embedding-based search, factual/thought/behavior types, and cross-session recall. It uses `IMemoryDatabase` / `CortexMemoryDatabase` as its backend.

## Adding a Persistent Backend

To replace `MemoryPlugin`'s in-memory array with a persistent store, implement `MemoryProvider` and update `MemoryPlugin` to delegate its storage to it. No concrete implementation currently exists in this directory.
