# Assessment: FFmpegPlugin
**File:** src/plugins/FFmpegPlugin.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [ ] `validateInputPath` absolute-path edge case (lines 514–519): The `relative(process.cwd(), resolve(filePath))` check correctly blocks `..`-prefixed relative results, which covers absolute paths outside cwd. On Windows (different-drive paths), `relative()` would not produce a `..` prefix — not a concern on macOS/Linux but worth noting if the codebase ever targets Windows. No action needed on the current platform.
- [x] ~~`imagesToVideo` did not validate `inputPattern` against path traversal~~ — **Fixed**: lines 744–747 now reject patterns starting with `..` or `/`.
- [x] ~~`concatenate` and `imagesToVideo` temp files used `Date.now()` suffix, risking collision under concurrent calls~~ — **Fixed**: both now use `crypto.randomUUID()` (lines 707 and 766).
- [x] ~~`dirEnsured` instance flag caused silent failures if `downloads/` was deleted at runtime~~ — **Fixed**: the flag has been removed; `ensureDownloadsDir()` is called unconditionally in each operation.
- [ ] `executeTool` switch has no `default` branch (lines 416–502): returns `undefined` for unknown names. This is correct per plugin convention — no fix needed.

## Refactoring / Code Quality
- [ ] `DOWNLOADS_DIR = "downloads"` (line 6) is duplicated from `YtDlpPlugin.ts`. Extract to a shared constant (e.g., `src/paths.ts`) to avoid drift if the directory name ever changes.
- [ ] `stem(filePath)` private helper (lines 504–506) re-implements `basename(filePath, extname(filePath))` in one line. The method adds no abstraction value; replace its call sites with the direct stdlib expression and remove the helper.
- [ ] `buildAtempoChain` (lines 982–995) is defined at module scope, not exported. If audio-speed logic is ever needed elsewhere it will be duplicated. Consider exporting it or moving it to a shared utilities module.
- [ ] ~10 methods share an identical pattern: validate path → compute output path → log → try/catch ffmpeg call → return structured result. Extracting a private `runFfmpeg(label, inputFile, outputPath, buildCmd)` helper would significantly reduce boilerplate and centralise error formatting.
- [x] ~~`ffmpeg_images_to_video` tool definition had `required: []` with no hint to the LLM~~ — **Fixed**: the description now explicitly states that either `input_pattern` or `input_files` must be provided (line 195).

## Security
- [x] ~~`inputPattern` path traversal: a glob like `../../etc/*` could instruct ffmpeg to read files outside the working directory~~ — **Fixed**: lines 744–747 reject patterns starting with `..` or `/`.
- [ ] `stderr` from ffmpeg is returned directly in error responses (e.g., line 598). May expose internal paths, codec details, or system information to the LLM. Acceptable for a developer-facing tool but document this intentional choice.
- [ ] The plugin shells out to `ffmpeg`/`ffprobe` binaries resolved from `PATH` with no validation that the resolved binary is the expected one. Standard practice for CLI wrappers; acceptable in the controlled deployment environment.
- [ ] `videoFilter` and `audioFilter` in `speed` (lines 929–930) are constructed from a validated `number` (range checked at line 919) and the output of `buildAtempoChain`, which only emits numeric parameters. No injection risk.
- [ ] `cropFilter` (line 900) and `scale` (line 665) are constructed purely from validated `number` parameters. No injection risk.

## Performance
- [ ] `getInfo` calls `ffprobe` as a subprocess on every invocation with no caching (line 531). Workflows that inspect the same file multiple times (e.g., `get_info` then `trim`) incur redundant process overhead. Low impact in practice.
- [ ] No timeout is set on any ffmpeg subprocess call. Long-running operations will block the agent indefinitely. Consider a configurable `operationTimeoutMs` constructor option.
- [ ] `concatenate` and `imagesToVideo` use `-c copy` to avoid re-encoding (lines 716, 773). This is optimal.

## Consistency / Style Alignment
- [ ] All write-operation methods return `{ success: true, output_file: string }` consistently. `getInfo` returns a richer object without `output_file` — intentional and documented in the tool description.
- [ ] `logger.debug` / `logger.error` with the `"FFmpeg"` tag are used consistently throughout.
- [ ] `rotation` parameter accepts both string and integer forms via a JSON Schema enum (line 399); the implementation normalises to `String(rotation)` before the `filterMap` lookup (line 963). Both forms are correctly handled.
- [ ] `args: any` in `executeTool` (line 415) is consistent with the plugin interface contract defined in `Plugin.ts`.

## Notes
- The three High-severity items from the previous assessment (`inputPattern` traversal, concurrent temp-file collision, `dirEnsured` statefulness) are all resolved. Risk level is now **Medium** due to the remaining refactoring debt (boilerplate across 10 methods) and the lack of an operation timeout.
- Cross-module concern: `YtDlpPlugin` writes to the same `downloads/` directory. Output filename collisions are possible if both plugins operate on files with the same stem concurrently. Neither plugin coordinates with the other.
- Cross-module concern: `buildAtempoChain` correctly handles atempo's [0.5, 2.0] per-filter range by chaining multiple `atempo` stages. Any future audio-speed work elsewhere in the codebase should reuse this function rather than re-implementing it.
- The plugin requires `ffmpeg` and `ffprobe` in `PATH`. No binary-presence check is performed at init time; the first tool call will fail with a shell error if either binary is absent. A startup check in `onInit` (if the plugin ever implements it) would give a clearer error message.
