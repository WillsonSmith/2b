# Assessment: logger
**File:** src/logger.ts
**Reviewed:** 2026-03-26
**Risk level:** Low

## Bug Fixes
- [ ] Silent discard of invalid `LOG_LEVEL` values (line 41–42): `getConfiguredLevel` casts the raw env string directly to `LogLevel` before passing it to `LEVELS`. If `LOG_LEVEL` is set to an unrecognised value (e.g. `"VERBOSE"`), the cast silently produces `undefined` and the `??` fallback returns `LEVELS.OFF`, suppressing all output with no warning. Consider validating against the known keys of `LEVELS` and emitting a one-time `console.warn` when the value is unrecognised.
- [ ] `OFF` color entry (line 35): `COLORS.OFF` is `""`. If `log` is called with `level = "OFF"` directly, it produces a log line with no color prefix and no reset code, leaving terminal state unchanged. Add an early return when `level === "OFF"`.

## Refactoring / Code Quality
- [ ] `getConfiguredLevel` called on every `log` invocation (line 46): Reading and parsing `process.env.LOG_LEVEL` on every call adds overhead in hot paths. Cache the resolved level at module load time.
- [ ] Duplicate escape codes across `ANSI_COLORS` and `COLORS` maps (lines 3–36): `gray`/`COLORS.DEBUG`, `cyan`/`COLORS.INFO`, `yellow`/`COLORS.WARN`, `red`/`COLORS.ERROR` are identical. Either use `ANSI_COLORS` as the single source of truth or document that `colorize` is an intentionally separate public API.
- [ ] `colorize` raw ANSI fallback (line 18): Unrecognised `color` values are passed through as escape codes with no validation, making misuse undetectable at compile time.
- [ ] Timestamp truncation (line 49): `new Date().toISOString().slice(11, 23)` is fragile if the ISO format ever changes.

## Security
No issues found.

## Performance
- [ ] Per-call `getConfiguredLevel` (line 46): Cache the level at module initialisation to avoid repeated env reads in high-throughput agent loops.

## Consistency / Style Alignment
- [ ] Duplicate reset code (lines 19, 38): `ANSI_COLORS.reset` and the module-level `RESET` constant both hold `"\x1b[0m"`. Consolidate to one source.
- [ ] Parameter name inconsistency (lines 45, 60–63): `log` uses `namespace`/`message`; the `logger` shorthand methods use `ns`/`msg`.
