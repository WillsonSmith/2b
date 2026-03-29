# Assessment: NotesPlugin
**File:** src/plugins/NotesPlugin.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] `executeTool` returns `undefined` for unknown tool names instead of explicit `undefined`: The function has no final `return` statement after all `if` branches. While JavaScript implicitly returns `undefined`, the plugin convention (per `src/plugins/CLAUDE.md`) states "Return `undefined` (not throw) from `executeTool` for unknown tool names." An explicit `return undefined;` at the end of `executeTool` would make the intent clear and guard against future refactors silently swallowing unhandled tool names.
- [x] `list_notes` does not handle a missing `NOTES_DIR`: If `appDataPath("notes")` returns a path that does not yet exist, `Bun.Glob.scan` will throw (directory not found). `create_note` implicitly creates the directory via `Bun.write`, but if `list_notes` is called first the error is unhandled and surfaces as an uncaught exception rather than a clean `{ notes: [], count: 0 }`.

## Refactoring / Code Quality
- [x] Empty `constructor()`: Line 24 declares `constructor() {}` explicitly. This is unnecessary noise; remove it and let the implicit default constructor apply.
- [x] `args: any` typing on `executeTool` (line 77): Each `if` branch accesses `args.title` and/or `args.content` without runtime type guards. Narrowing with `typeof args.title === "string"` (or a small helper) would catch malformed inputs before they reach `safeNotePath` or `Bun.write`.
- [x] `create_note` silently overwrites existing notes: The tool description says "Create or overwrite" but the system-prompt fragment only mentions "save." There is no confirmation path or `overwrite` flag. This is a design decision worth documenting as intentional, or offering an `update_note` / `overwrite: boolean` parameter to avoid unintentional data loss. — documented as intentional in `getSystemPromptFragment()`; no schema change made (scope risk).

## Security
- [x] `unlinkSync` from `node:fs` used for deletion (line 3, 106): The project convention (CLAUDE.md) prefers Bun APIs over Node.js `fs` equivalents. While `unlinkSync` is safe here and `safeNotePath` prevents path traversal, using `Bun.file` for all I/O is inconsistent with the rest of the module. There is no async Bun equivalent for unlink yet, but `import { rm } from "node:fs/promises"` with `await` would at least make the deletion non-blocking and avoid mixing sync I/O in an otherwise async method.
- [ ] Path traversal guard is sound but brittle on Windows-style paths: `safeNotePath` (lines 16–17) checks `rel.startsWith("..")`. On a non-POSIX system, a relative path could start with `..\` rather than `../`. The current deployment target appears to be macOS so this is low risk in practice, but worth noting. — **Skipped**: deployment target is macOS only; change would add complexity without practical benefit.

## Performance
- [ ] `list_notes` collects all note filenames into memory before returning: For typical note counts this is fine, but there is no upper bound. If `NOTES_DIR` somehow accumulated thousands of files, the full array would be built before responding. A `limit` parameter (or lazy streaming) could future-proof this, matching the pattern used by other plugins (e.g. `RSSPlugin`'s `limit` argument). — **Skipped**: adding a `limit` parameter changes the public tool schema, which is outside the module's current scope.

## Consistency / Style Alignment
- [ ] Uses `node:path` (`join`, `resolve`, `relative`, `isAbsolute`) instead of Bun path utilities: The project's CLAUDE.md does not explicitly ban `node:path`, and Bun re-exports it, so this is low priority. However, other file-handling plugins (`FileIOPlugin`) similarly use `node:path`, so this is consistent across the codebase — no change required.
- [x] Uses `unlinkSync` from `node:fs` (line 3): As noted under Security, `node:fs` sync I/O is inconsistent with the Bun-first convention. Prefer `node:fs/promises` `rm` or wait for a native Bun unlink API.
- [x] `list_notes` tool definition has an empty `properties: {}` object (line 50): Other zero-parameter tools in the codebase omit the `properties` key entirely or use `required: []`. This is a minor inconsistency that could confuse schema validators.

## Notes
- `safeNotePath` is a well-implemented guard — path traversal protection is correctly applied before every file operation.
- The plugin does not implement `onInit`, so `NOTES_DIR` is never pre-created. Downstream callers of `list_notes` before any note is created will receive an unhandled error (see Bug Fixes).
- No cross-module dependencies beyond `../logger.ts` and `../paths.ts`; low coupling.
- The `create_note` / `read_note` asymmetry (write prepends `# title\n\n`, read returns raw file content including that header) means the returned `content` field on `read_note` includes the injected heading. This may surprise callers expecting only the user-supplied content.
