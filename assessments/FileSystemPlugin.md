# Assessment: FileSystemPlugin
**File:** src/plugins/FileSystemPlugin.ts
**Reviewed:** 2026-03-30
**Risk level:** Medium

## Bug Fixes
- [x] `readFile` pagination is advertised but non-functional for large files: The 1 MB size check (line ~265) throws _before_ `offset`/`limit` can be applied. The tool description says "Use offset and limit to page through files larger than 1 MB", but that is impossible — any file over 1 MB always throws. Fix: remove the pre-read size check and instead stream/chunk the file, or check byte count only after slicing lines.
- [ ] `executeTool` silently returns `undefined` for unknown tool names (line ~243): An unrecognised tool name produces no error, which makes misrouted calls fail invisibly. Fix: add a `default: throw new Error(\`Unknown tool: \${name}\`)` branch. **SKIPPED**: `src/plugins/CLAUDE.md` requires `executeTool` to return `undefined` for unknown names so that other plugins in the chain can handle the tool call. Throwing would break multi-plugin routing.

## Refactoring / Code Quality
- [x] All private methods return absolute `resolved` paths in their result objects (e.g. `readFile` line ~283, `writeFile` line ~295, etc.): The caller (and ultimately the LLM) receives the full host filesystem path. There is no reason to expose `/Users/willsonsmith/Developer/AI/2b/…` in tool results. Fix: return `relative(BASE_DIR, resolved)` instead.
- [x] `validatePath` is a free function at module scope rather than a private method: Everything else lives on the class; this one helper is inconsistent and cannot be overridden or injected in tests. Fix: move it to `private validatePath(path: string): string`.
- [x] `BASE_DIR` is captured at module-load time from `process.cwd()` (line 14): If the process ever changes its working directory (e.g. during testing), the plugin silently uses a stale root. Fix: capture it in the constructor and expose it as an instance property so it can be set explicitly.
- [ ] `readFile` reads the _entire_ file into memory with `file.text()` before slicing lines (line ~270): Even when only 10 lines are needed from a 900 KB file, all 900 KB are allocated as a string. Fix: for small files this is fine, but add a fast path that skips the full read when `offset === undefined && limit === undefined` is false and the file is large. **SKIPPED**: Implementing per-line streaming in Bun requires significantly more complex code; the minimal safe change does not justify the complexity at this time.

## Security
- [ ] `validatePath` checks `rel.startsWith("..")` (line ~18): On Windows (not applicable here, but worth noting) NTFS alternate data stream paths and device paths can bypass this. For the current macOS/Linux target this is acceptable, but the check would be more robust with `!rel.startsWith("..") && !isAbsolute(rel)` already in use — no change needed here; record for awareness.
- [x] `delete_file` uses `unlink` which only removes files; symlinks to sensitive files outside the sandbox can be deleted by their in-sandbox path if the symlink itself resides inside the sandbox. `validatePath` validates the _symlink path_, not its target. Fix: add a `lstat`/`realpath` check on the resolved path to confirm the real target also resides within `BASE_DIR`.
- [x] Absolute paths in responses (see Refactoring item above) also have a security dimension: leaking full host paths to a model context that may be sent to external APIs is an unnecessary information disclosure.

## Performance
- [x] `listDirectory` calls `Bun.file(entryPath).size` inside a `Promise.all` for every file entry (line ~315): `Bun.file().size` is synchronous but still opens a file descriptor per entry. For large directories this creates significant overhead. Fix: use `entry` dirent's already-available stat data if Bun exposes it, or batch a single `stat` call per entry rather than opening a Bun file handle.
- [x] `findFiles` accumulates all matches in an in-memory array before returning (line ~388): For patterns matching thousands of files this can be unexpectedly large. Fix: add an optional `limit` parameter and early-exit the scan loop once the limit is reached.

## Consistency / Style Alignment
- [x] `read_file` and `stat_file` lack `permission` fields while all mutating tools have `permission: "per_call"` — this is correct and intentional, but is not documented. Add a comment noting which tools are read-only vs. mutating to make auditing easier.
- [x] `find_files` uses `onlyFiles: false` (line ~388), which means the results include directories, yet the tool is named `find_files` and described as searching for _files_. Fix: either set `onlyFiles: true` or rename/redescribe the tool to `find_entries`.
- [x] Return type of `appendFile` only returns `{ path }` (no `size`), while `writeFile` returns `{ path, size }`: inconsistent result shape for similar operations. Fix: return `{ path, size }` from `appendFile` as well (stat the file after appending, or use `Bun.file(resolved).size`).

## Notes
- The plugin relies on `process.cwd()` at import time; integration tests that change working directory will silently operate on the wrong root unless this is refactored (see Refactoring item).
- The `copy_file` tool explicitly states it does not copy directories. There is no enforcement of this in the implementation — `fsCopyFile` will throw a native error, but the message will be an OS-level one rather than the friendly plugin message. Consider an explicit `stat` check and a clear error before attempting the copy.
- Symlink handling in `listDirectory` returns `{ name, type: "symlink" }` with no target info. The LLM has no way to know what the symlink points to, which may cause confusion. A `target` field from `readlink` would improve usefulness.
