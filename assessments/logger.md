# Logger Assessment

## Module Overview

`src/logger.ts` is the project-wide structured logging utility. It provides leveled, namespaced, colorized log output to stdout. Every module that needs to emit diagnostic information imports from here rather than calling `console.log` directly. The module deliberately avoids third-party dependencies — it uses only ANSI escape codes and the built-in `process.env` API.

## Interface / Exports

### `LogLevel` (type)
```ts
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "OFF";
```
A union type representing all valid log levels, from most verbose (`DEBUG`) to completely silent (`OFF`).

### `colorize(text: string, color: string): string`
Wraps `text` in ANSI escape codes. `color` can be a named key from the internal `ANSI_COLORS` map (`reset`, `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, `gray`) or a raw ANSI escape sequence string. Falls back to treating the value as a raw ANSI code if the name is not found.

### `log(level: LogLevel, namespace: string, message: string, data?: unknown): void`
The core logging function. Checks whether the current log level (from `LOG_LEVEL` env var) permits this message, then formats and writes it to stdout via `console.log`. The timestamp is truncated to `HH:MM:SS.mmm` from an ISO-8601 string. When `data` is provided, it is passed as a second argument to `console.log` for native object formatting.

### `logger` (object)
```ts
export const logger = {
  debug: (ns: string, msg: string, data?: unknown) => log("DEBUG", ns, msg, data),
  info:  (ns: string, msg: string, data?: unknown) => log("INFO",  ns, msg, data),
  warn:  (ns: string, msg: string, data?: unknown) => log("WARN",  ns, msg, data),
  error: (ns: string, msg: string, data?: unknown) => log("ERROR", ns, msg, data),
};
```
A convenience object with one method per named level. All consumers use this rather than calling `log` directly. The `ns` argument is a short namespace string (e.g., `"BaseAgent"`, `"CortexDB"`) that appears in the bracket prefix.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LOG_LEVEL` | `"OFF"` | Controls minimum severity of messages printed. Set to `DEBUG`, `INFO`, `WARN`, or `ERROR`. Any unrecognized value falls back to `OFF`. |

Level numeric values used for comparison:

| Level | Value |
|---|---|
| DEBUG | 0 |
| INFO  | 1 |
| WARN  | 2 |
| ERROR | 3 |
| OFF   | 99 |

A message is printed only if `LEVELS[level] >= getConfiguredLevel()`.

## Data Flow

1. A module calls e.g. `logger.info("Namespace", "message", optionalData)`.
2. `log("INFO", ...)` is invoked.
3. `getConfiguredLevel()` reads `process.env.LOG_LEVEL` and returns the numeric threshold.
4. If the message's numeric level is below the threshold, execution returns immediately — no I/O.
5. If the level passes, the current time is extracted from `new Date().toISOString()` (chars 11–23 = `HH:MM:SS.mmm`).
6. The prefix `[LEVEL][namespace]` is wrapped in the level's ANSI color code.
7. `console.log` emits the formatted line, with `data` appended as a second argument if present.

## Code Paths

### Normal output path
`logger.info("MyPlugin", "doing thing")` → `log("INFO", "MyPlugin", "doing thing", undefined)` → level check passes → timestamp generated → prefix colorized cyan → `console.log("12:34:56.789 \x1b[36m[INFO][MyPlugin]\x1b[0m doing thing")`.

### Suppressed output path
`LOG_LEVEL` unset or `"OFF"` → `getConfiguredLevel()` returns 99 → `LEVELS["INFO"]` (1) < 99 → function returns without printing.

### With data object
`logger.debug("CortexDB", "got embedding", { dim: 384 })` → `console.log("... [DEBUG][CortexDB] got embedding", { dim: 384 })` — the object is passed as a second argument so the terminal formats it natively (expandable in Node/Bun inspect).

### `colorize` with unknown color name
`colorize("text", "\x1b[35m")` — the string is not found in `ANSI_COLORS`, so it is used directly as the escape code via the `??` fallback. This lets callers pass raw ANSI codes.

## Helper Functions / Internals

### `ANSI_COLORS` (unexported `Record<string, string>`)
Maps 9 friendly color names to ANSI escape sequences. Used by `colorize` and indirectly referenced by the level-color mapping in `COLORS`.

### `LEVELS` (unexported `Record<LogLevel, number>`)
Numeric comparison values for level ordering. `OFF` is intentionally set to 99 to ensure it is always above any real level.

### `COLORS` (unexported `Record<LogLevel, string>`)
Maps each `LogLevel` to its ANSI color escape code. `OFF` maps to an empty string (it is never passed to `log` in practice, since `OFF` is only ever a threshold level, not a message level).

### `RESET` (unexported constant)
The ANSI reset sequence `\x1b[0m`, used in the prefix construction to terminate the color after the bracket label.

### `getConfiguredLevel(): number`
Reads `process.env.LOG_LEVEL` on every invocation (not cached). Upcases the value, looks it up in `LEVELS`, and falls back to `LEVELS.OFF` (99) if unrecognized. Because this is not cached, `LOG_LEVEL` can be mutated at runtime and the logger will pick up the new value on the next call.

## Error Handling

The logger has no internal error handling. `console.log` is assumed to never throw. If `process.env.LOG_LEVEL` contains an unrecognized string, `LEVELS[raw]` evaluates to `undefined` and the `?? LEVELS.OFF` fallback silently defaults to `OFF` (fully suppressed).

## Integration Context

`logger` is the most widely imported module in the codebase. Known consumers:

- **Core**: `src/core/BaseAgent.ts`, `src/core/HeadlessAgent.ts`
- **Providers**: `src/providers/llm/LMStudioProvider.ts`, `src/providers/audio/AudioSystem.ts`, `src/providers/audio/AudioProvider.ts`, `src/providers/audio/TranscriptionProvider.ts`
- **Plugins**: `MemoryPlugin`, `CortexMemoryPlugin`, `CortexMemoryDatabase`, `ThoughtPlugin`, `AudioPlugin`, `TimePlugin`, `TMDBPlugin`, `RSSPlugin`, `WeatherPlugin`, `WebSearchPlugin`, `WebReaderPlugin`, `WikipediaPlugin`, `ShellPlugin`, `ClipboardPlugin`, `NotesPlugin`, `FFmpegPlugin`, `YtDlpPlugin`, `CodeSandboxPlugin`
- **Input sources**: `CLIInputSource`, `MicrophoneInputSource`
- **Utilities**: `src/utils/deviceSelector.ts`, `src/utils/stream-tts.ts`

No module re-exports the logger — it is always imported directly from `../logger.ts` or `../../logger.ts` with a relative path.

## Observations / Notes

- **`LOG_LEVEL` is read on every call** via `getConfiguredLevel()`. There is no module-load-time caching. This is slightly inefficient on high-frequency paths (e.g., token streaming) but allows runtime log-level changes without process restart.
- **Default is `OFF`**: Nothing is logged unless `LOG_LEVEL` is explicitly set. This is a conservative default that avoids noisy output in production or when running tests.
- **No file sink or JSON mode**: All output goes to stdout via `console.log`. There is no structured JSON output, file rotation, or remote logging target.
- **`colorize` is exported but rarely used externally** — it primarily exists so other modules with custom color formatting needs (e.g., CLI output) can reuse the same ANSI palette.
- **Timestamp drops the date**: Slicing chars 11–23 of an ISO string yields `HH:MM:SS.mmm`. This is sufficient for interactive debugging but log lines do not self-identify across day boundaries.
- **No automatic caller context**: Unlike structured loggers (e.g., pino, winston), there is no automatic file/line injection. The `namespace` string must be supplied manually by each caller, creating a convention dependency.
- **`OFF` as a level value**: `OFF` is included in `LogLevel` and `COLORS` but should never be passed as the `level` argument to `log()`. If it were, its color would be an empty string (no colorization) and it would only print if `LOG_LEVEL` were set below 99 — which is impossible with the defined levels.
