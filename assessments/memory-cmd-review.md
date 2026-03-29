# Assessment: memory-cmd
**File:** src/cli/memory-cmd.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] `clearMemories` does not close stdin after reading (lines 82–85): After reading one line of input via `process.stdin.once("data", ...)`, stdin is left in flowing mode. This can prevent the process from exiting cleanly in non-TTY environments. After resolving the answer, call `process.stdin.pause()` or `process.stdin.destroy()`.
- [ ] `clearMemories` deletes from `memories_fts` with a bare `DELETE FROM` (line 94): SKIPPED — `memories_fts` is a plain (non-content) FTS5 table; bare `DELETE FROM` is valid and does not corrupt the index. The `delete-all` command syntax applies only to content tables.
- [x] `openDb` calls `process.exit(1)` synchronously (lines 13–14): Any open database handles or other async resources will not be flushed cleanly. Throw an error instead and let the caller (or a top-level handler) decide whether to exit.
- [x] `listMemories` and `searchMemories` do not close the database on error (lines 116–119, 128–131): If the prepared statement throws (e.g. schema mismatch), `db.close()` in `runMemoryCommand` is never reached. Wrap db usage in try/finally blocks.

## Refactoring / Code Quality
- [x] `existsSync` import from `node:fs` (line 3): CLAUDE.md specifies preferring `Bun.file` over `node:fs`. Replace `existsSync(DB_PATH)` with `await Bun.file(DB_PATH).exists()` and make `openDb` async.
- [x] Repeated inline type `{ id: string; type: string; timestamp: number; text: string }` (lines 27, 39, 59): This type is duplicated three times. Extracted as named interface `MemoryRow` at the top of the file.
- [ ] `printRows` is not reused — `listMemories` and `searchMemories` both call it identically (lines 47, 67): SKIPPED — assessment notes this is "fine structurally"; conservative approach taken.
- [x] ANSI color constants declared as comma-separated `const` bindings on one line (line 6): Separated into individual `const` declarations.
- [x] `runMemoryCommand` uses sequential `if` chains instead of a `switch` (lines 115–144): Converted to `switch (sub)` block.

## Security
- [x] FTS query passed directly to `.all(query)` without sanitization (line 59): SQLite's FTS5 `MATCH` syntax accepts special operators (`AND`, `OR`, `NOT`, `*`, `"`). A malformed or adversarial query string will throw a runtime error that is not caught, crashing the CLI. Wrapped in try/catch with a user-friendly error message.
- [ ] `DB_PATH` is derived from `APP_DATA_DIR` which reads `XDG_DATA_HOME` from the environment (line 8, via `src/paths.ts`): SKIPPED — fix is out of this module's scope; tracked in `paths-review.md`.

## Performance
- [x] `listMemories` fetches all rows without a `LIMIT` (line 38): If the database grows large, this will load every row into memory and print an unbounded number of lines. Added `LIMIT 100` with a truncation notice when results are capped.
- [ ] `clearMemories` issues a `COUNT(*)` query and then three separate `DELETE` statements inside a transaction (lines 71–96): SKIPPED — acceptable for a CLI tool as noted in assessment.

## Consistency / Style Alignment
- [x] `node:fs` import (line 3) deviates from the project convention of preferring Bun APIs — resolved by migrating to `Bun.file().exists()`.
- [ ] `node:path` import (line 2): SKIPPED — widely accepted deviation; no Bun-specific path module equivalent.
- [ ] Error paths use `process.exit(1)` (lines 14, 127, 144): SKIPPED — `openDb` now throws instead of exiting; the outer CLI handler exit calls (lines 127, 144) require auditing other CLI modules for consistency before aligning, which is out of this module's scope.
- [x] `formatDate` uses `toLocaleString()` without a locale argument (line 20): Passed explicit `"en-US"` locale for consistent output across machines.

## Notes
- This module depends on `src/paths.ts` for `APP_DATA_DIR`. Issues identified in the `paths` assessment (environment-variable path injection, lack of path traversal guards) are inherited here.
- The FTS join in `searchMemories` assumes a virtual table named `memories_fts` with a `memory_id` column. If the schema changes, this query will silently return no results or throw. Consider adding a schema-version guard or a startup check.
- The `clearMemories` transaction deletes from `memory_links`, `memories_fts`, and `memories` in that order. Reviewers of any module that writes to these tables should verify foreign-key constraints and cascade rules are consistent with this deletion order.
