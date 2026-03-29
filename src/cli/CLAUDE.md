# CLI

Command-line subcommands for managing the agent outside of a chat session. Wired into the main entry point (`index.ts`) so they're accessible as `bun run index.ts <command> <subcommand>`.

## Files

| File | Purpose |
|------|---------|
| `memory-cmd.ts` | Inspect and manage the `CortexMemoryPlugin` SQLite database |

## memory-cmd

Exports `runMemoryCommand(args: string[])`. Operates directly on `data/2b.cortex.sqlite` via `bun:sqlite` — the database path is hardcoded to `APP_DATA_DIR/data/2b.cortex.sqlite`.

**Subcommands:**

| Command | Description |
|---|---|
| `2b memory list` | Shows up to 100 most recent memories (id, type, timestamp, truncated text) |
| `2b memory search <query>` | Full-text search on `memories_fts` (SQLite FTS5); query is passed directly to `MATCH` |
| `2b memory clear [--force]` | Deletes all rows from `memories`, `memory_links`, `memories_fts`; prompts for confirmation without `--force` |

The database must exist before running any subcommand — it is created by running the agent at least once.

## Gotchas

- `memory search` passes the query string directly to SQLite FTS5 `MATCH`. SQLite FTS5 syntax is not the same as plain text search — queries with special characters may fail. The command catches parse errors and prints a user-friendly message.
- `memory clear` is destructive and permanent. The `--force` flag skips the confirmation prompt.
- The DB path is fixed at `data/2b.cortex.sqlite` relative to `APP_DATA_DIR`. If a different `cortexName` was used for the agent, the path will not match.
