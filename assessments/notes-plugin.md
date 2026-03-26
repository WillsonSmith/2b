# NotesPlugin Assessment

## Module Overview

`NotesPlugin` provides the agent with persistent, cross-conversation note storage using plain markdown files. Notes are stored as `.md` files in a platform-appropriate application data directory (`~/.local/share/2b/notes/` by default, following XDG conventions). The plugin exposes four tools — create, list, read, and delete — enabling the agent to maintain a durable knowledge store that survives between sessions. Filenames are derived from note titles with strict sanitization to prevent path traversal and filesystem issues.

## Interface / Exports

### `class NotesPlugin implements AgentPlugin`

| Member | Signature | Purpose |
|---|---|---|
| `name` | `string = "Notes"` | Plugin identifier |
| `getSystemPromptFragment()` | `() => string` | Injects guidance on when to create/read notes |
| `getTools()` | `() => ToolDefinition[]` | Returns four tool definitions |
| `executeTool(name, args)` | `async (name, args) => Promise<any>` | Dispatches to inline tool implementations |

### Registered Tools

| Tool | Required args | Return shape |
|---|---|---|
| `create_note` | `title, content` | `{ success: true, path }` |
| `list_notes` | none | `{ notes: string[], count: number }` |
| `read_note` | `title` | `{ title, content }` or `{ error }` |
| `delete_note` | `title` | `{ success: true }` or `{ error }` |

### Module-level constant

| Constant | Value |
|---|---|
| `NOTES_DIR` | `appDataPath("notes")` → `~/.local/share/2b/notes/` (XDG) or `$XDG_DATA_HOME/2b/notes/` |

## Configuration

No constructor arguments (empty constructor is present but has no body). No environment variables used directly by this plugin. The `NOTES_DIR` location is determined by `src/paths.ts`:

- Reads `XDG_DATA_HOME` environment variable if set.
- Falls back to `~/.local/share/2b/notes/`.
- The directory is created with `mkdirSync({ recursive: true })` at module load time via `appDataPath()`.

## Data Flow

### Create
```
title + content → safeNotePath(title) → resolved .md path
  → content prefixed with "# <title>\n\n"
  → Bun.write(path, content)
  → return { success: true, path }
```

### List
```
Bun.Glob("*.md").scan(NOTES_DIR)
  → strip ".md" extension from each filename
  → return { notes: string[], count }
```

### Read
```
title → safeNotePath(title) → Bun.file(path)
  → exists check
  → file.text()
  → return { title, content }
```

### Delete
```
title → safeNotePath(title) → Bun.file(path)
  → exists check
  → unlinkSync(path)
  → return { success: true }
```

## Code Paths

### `safeNotePath(title: string): string`
This is the critical security function for the plugin:
1. Strips all characters except `[a-zA-Z0-9_\- ]` (whitelist approach).
2. Trims leading/trailing whitespace.
3. Replaces runs of spaces with a single `-`.
4. Throws `"Invalid note title."` if the sanitized result is empty.
5. Resolves the full path: `NOTES_DIR/<sanitized>.md`.
6. Computes the relative path from `NOTES_DIR` to the resolved path.
7. Throws `"Invalid note path."` if the relative path starts with `..` or is absolute. This is a belt-and-suspenders check — the whitelist sanitization above should make traversal impossible, but this provides a second layer of defense.

### `create_note`
1. Calls `safeNotePath(args.title)`.
2. Prepends `# <title>\n\n` to `args.content` to produce a well-formed markdown file.
3. `Bun.write()` overwrites any existing note with the same title (no merge, no confirmation).
4. Logs path at info level.
5. Returns `{ success: true, path }`.

### `list_notes`
1. Uses `new Bun.Glob("*.md")` and `glob.scan(NOTES_DIR)` to iterate all markdown files.
2. Strips `.md` extension from each filename.
3. Returns the list and count. Order is filesystem-dependent and not guaranteed.

### `read_note`
1. Calls `safeNotePath(args.title)`.
2. Checks `file.exists()`.
3. If not found, returns `{ error: "Note \"<title>\" not found." }` (non-throwing).
4. Returns full file content as text.

### `delete_note`
1. Calls `safeNotePath(args.title)`.
2. Checks `file.exists()`.
3. If not found, returns `{ error: "Note \"<title>\" not found." }` (non-throwing).
4. Calls `unlinkSync(path)` (synchronous deletion).
5. Logs at info level.
6. Returns `{ success: true }`.

## Helper Functions / Internals

### `safeNotePath(title: string): string` (module-level, not exported)
Converts a user-supplied note title into a safe, predictable filesystem path within `NOTES_DIR`. The whitelist regex and double path validation make this resistant to path traversal. The sanitization is lossy: titles that differ only in special characters (e.g., `"Hello!"` and `"Hello"`) resolve to the same file.

## Error Handling

| Scenario | Handling |
|---|---|
| Invalid/empty title after sanitization | `safeNotePath` throws `"Invalid note title."` — propagates to LLM as tool error |
| Path escapes NOTES_DIR (should be impossible) | `safeNotePath` throws `"Invalid note path."` |
| Note not found (read) | Returns `{ error: "Note \"...\" not found." }` — non-throwing |
| Note not found (delete) | Returns `{ error: "Note \"...\" not found." }` — non-throwing |
| `Bun.write` failure | Unhandled — propagates as rejection |
| `unlinkSync` failure | Unhandled — throws synchronously, not caught in `executeTool` |
| `glob.scan` failure | Unhandled — propagates as rejection |

`delete_note` uses `unlinkSync` (synchronous). If the file is removed between the `exists()` check and `unlinkSync` (TOCTOU race), `unlinkSync` will throw a synchronous error that is not caught within the method.

## Integration Context

**Registered in:** `src/agents/sub-agents/createInfoAgent.ts` alongside `TMDBPlugin` and `WeatherPlugin`.

```typescript
new HeadlessAgent(llm, [new TMDBPlugin(), new WeatherPlugin(), new NotesPlugin()], ...)
```

**Depends on:**
- `src/core/Plugin.ts` — `AgentPlugin`, `ToolDefinition`
- `src/logger.ts` — info-level logging for create/delete
- `src/paths.ts` — `appDataPath()` for XDG-compliant data directory resolution
- `node:path` — `join`, `resolve`, `relative`, `isAbsolute`
- `node:fs` — `unlinkSync`
- Bun built-ins: `Bun.write`, `Bun.file`, `Bun.Glob`

**Storage location:** `~/.local/share/2b/notes/` (or `$XDG_DATA_HOME/2b/notes/`). Notes persist independently of any individual agent session and are shared across all agents that use `NotesPlugin`.

## Observations / Notes

1. **`create_note` is a blind overwrite:** There is no existence check before writing. If a note with the same title already exists, it is silently replaced. The LLM has no way to know a previous note was overwritten unless it explicitly calls `read_note` first.

2. **Title sanitization is lossy:** Characters like `!`, `@`, `#`, `.`, `,`, `(`, `)` are stripped. The title `"Python 3.11"` becomes `"Python 311"` (the period is removed). The actual path is returned in the create response, so the LLM can observe the sanitized form.

3. **`list_notes` returns sanitized filenames, not original titles:** The file is named after the sanitized title. However, since the same sanitization is applied on both write and read, lookups by original title will still resolve to the correct file.

4. **`unlinkSync` in an async context:** The delete operation uses synchronous file deletion inside an async method, momentarily blocking the event loop. For small files this is negligible, but it is inconsistent with the plugin's otherwise async approach.

5. **No content size limit:** Notes can be arbitrarily large. A very large note read back into agent context could exceed LLM context window limits.

6. **`list_notes` order is nondeterministic:** `Bun.Glob.scan` yields files in filesystem order, which is not guaranteed to be alphabetical or chronological.

7. **Notes directory is created at module load time:** `appDataPath("notes")` calls `mkdirSync({ recursive: true })` when the module is first imported. This is a side effect at import time but is acceptable for a persistent storage plugin.

8. **TOCTOU on delete:** The pattern of `file.exists()` check followed by `unlinkSync()` is subject to a race condition. In the context of a single-user agent application this is very unlikely to matter in practice.

9. **The empty `constructor()` is redundant:** `constructor() {}` is equivalent to the implicit default constructor and could be removed without behavioral change.
