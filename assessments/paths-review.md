# Assessment: paths
**File:** src/paths.ts
**Reviewed:** 2026-03-26
**Risk level:** Medium

## Bug Fixes
- [ ] `appDataPath` performs a side effect on every call (line 16): `mkdirSync` is called unconditionally every time a path is resolved. While `{ recursive: true }` suppresses errors if the directory exists, it still issues a syscall on every invocation.
- [ ] No error handling around `mkdirSync` (line 16): If directory creation fails (permission denied, path is a file), the error propagates as an unhandled exception. Wrap in try/catch and throw a descriptive error.

## Refactoring / Code Quality
- [ ] `node:fs` import conflicts with project conventions (line 2): CLAUDE.md states "Prefer `Bun.file` over `node:fs`". `mkdirSync` has no direct Bun equivalent but should be noted as a deviation.
- [ ] `APP_DATA_DIR` is eagerly evaluated at module load (line 8): `homedir()` and `process.env.XDG_DATA_HOME` are read at import time. Fine for a server process but complicates unit testing.
- [ ] Single-responsibility concern: `appDataPath` both resolves a path and creates directories. Consider splitting into a pure resolver and a side-effecting variant.

## Security
- [ ] `XDG_DATA_HOME` is user-controlled (line 5): If set to an adversarial value (e.g. `/etc`), all derived paths will point there and `mkdirSync` will attempt to create directories there. Validate that `XDG_DATA_HOME` is an absolute path within an expected prefix.
- [ ] Path traversal via `segments` (line 14): Callers can pass segments containing `..`, which `join` will resolve, potentially escaping `APP_DATA_DIR`. Guard that the resolved `dir` starts with `APP_DATA_DIR`.

## Performance
- [ ] Unconditional `mkdirSync` on every call (line 16): Negligible for occasional use but measurable if called in a loop or on every agent message cycle.

## Consistency / Style Alignment
- [ ] Use of `node:path` rather than a Bun equivalent — consistent with `node:fs` deviation, worth tracking.
