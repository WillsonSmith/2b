# Paths Assessment

## Module Overview

`src/paths.ts` is a small infrastructure module responsible for resolving and creating the application's persistent data directory. It centralizes the XDG Base Directory Specification logic so that all other modules that need to write files to disk import a single, consistent path rather than each computing it independently.

## Interface / Exports

### `APP_DATA_DIR` (constant `string`)
```ts
export const APP_DATA_DIR = join(XDG_DATA_HOME, "2b");
```
The absolute path to the root data directory for the application. Evaluates to `~/.local/share/2b` on a standard Linux/macOS system, or `$XDG_DATA_HOME/2b` if that environment variable is set. This constant is computed once at module load time.

### `appDataPath(...segments: string[]): string`
```ts
export function appDataPath(...segments: string[]): string
```
Resolves a sub-path inside `APP_DATA_DIR`, creates it recursively if it does not already exist, and returns the absolute path string. Callers pass path segments (e.g., `"notes"`, `"data"`) and receive back the full path including `APP_DATA_DIR` as the root.

**Example:**
```ts
appDataPath("notes")  // → "/home/user/.local/share/2b/notes" (created if absent)
appDataPath("data")   // → "/home/user/.local/share/2b/data"  (created if absent)
```

## Configuration

| Variable | Default | Behavior |
|---|---|---|
| `XDG_DATA_HOME` | `~/.local/share` | Overrides the base directory for all app data. If set, `APP_DATA_DIR` becomes `$XDG_DATA_HOME/2b`. |

`homedir()` from `node:os` is used to resolve `~` when `XDG_DATA_HOME` is absent.

## Data Flow

1. At module load time, `XDG_DATA_HOME` is read from `process.env` (or defaulted to `~/.local/share`).
2. `APP_DATA_DIR` is set to `XDG_DATA_HOME + "/2b"`.
3. When `appDataPath(...segments)` is called, `join(APP_DATA_DIR, ...segments)` produces the target path.
4. `mkdirSync(dir, { recursive: true })` ensures the directory exists. If it already exists, this is a no-op.
5. The resolved absolute path is returned to the caller.

Note: `APP_DATA_DIR` itself is **not** automatically created at module load — only `appDataPath()` calls trigger directory creation.

## Code Paths

### First-time call for a new subdirectory
`appDataPath("notes")` → `dir = "/home/user/.local/share/2b/notes"` → `mkdirSync` creates all intermediate directories → returns `"/home/user/.local/share/2b/notes"`.

### Subsequent call for the same subdirectory
`appDataPath("notes")` → `mkdirSync` is called again but is a no-op since the directory exists → returns the same path.

### Multi-segment call
`appDataPath("data", "cache")` → resolves to `APP_DATA_DIR/data/cache` → creates the full chain recursively.

### With `XDG_DATA_HOME` set
`XDG_DATA_HOME=/mnt/data` → `APP_DATA_DIR = "/mnt/data/2b"` → `appDataPath("notes")` returns `"/mnt/data/2b/notes"`.

### Direct use of `APP_DATA_DIR`
`src/cli/memory-cmd.ts` uses `APP_DATA_DIR` directly to construct a database path (`join(APP_DATA_DIR, "data", "2b.cortex.sqlite")`). This does **not** call `appDataPath()`, so it does not guarantee the directory exists (it checks separately with `existsSync`).

## Helper Functions / Internals

There are no unexported helper functions. The module is entirely composed of its two exports and one private constant.

### `XDG_DATA_HOME` (module-level `const`)
Not exported. Computed once at import time from `process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")`. All path resolution is relative to this value.

## Error Handling

`mkdirSync` with `{ recursive: true }` throws only on genuine filesystem errors (e.g., permission denied, path is a file, disk full). There is no try/catch wrapping — errors propagate to the caller. In practice, callers do not wrap `appDataPath()` either, so a filesystem error would crash the process at startup.

## Integration Context

Three modules import from `src/paths.ts`:

- **`src/cli/memory-cmd.ts`**: Imports `APP_DATA_DIR` to construct the hardcoded path `APP_DATA_DIR/data/2b.cortex.sqlite` for the CLI memory inspection tool.
- **`src/plugins/NotesPlugin.ts`**: Calls `appDataPath("notes")` at module load time to set the `NOTES_DIR` constant used for all note storage operations.
- **`src/plugins/CortexMemoryDatabase.ts`**: Calls `appDataPath("data")` inside the constructor to resolve the default SQLite database path (`<name>.cortex.sqlite`).

## Observations / Notes

- **Side effect at call time, not import time**: `APP_DATA_DIR` is just a string constant — no directory creation happens on import. `appDataPath()` is the only call that touches the filesystem. This means importing `paths.ts` is safe in tests or environments where the data directory should not be created.
- **`APP_DATA_DIR` is exposed directly**: Consumers like `memory-cmd.ts` bypass `appDataPath()` and construct paths manually from `APP_DATA_DIR`. This means those paths are not guaranteed to exist. It would be safer for all consumers to go through `appDataPath()`.
- **`mkdirSync` is synchronous**: Directory creation on every `appDataPath()` call is synchronous. For module-level constants (like `NOTES_DIR` in `NotesPlugin`), this happens at import time, which can slow startup if the filesystem is slow.
- **No path validation**: There is no check that segments don't escape `APP_DATA_DIR` (e.g., via `../`). Since all current callers use static string literals this is not an active risk, but it is something to be aware of if the API is ever used with user-provided input.
- **XDG compliance**: Following XDG allows power users and system administrators to redirect application data (e.g., to an external drive or a non-home partition) without patching code.
