# Assessment: FFmpegPlugin
**File:** src/plugins/FFmpegPlugin.ts
**Reviewed:** 2026-03-26
**Risk level:** High

## Bug Fixes
- [ ] `validateInputPath` does not block absolute paths (lines 516–522): The check is `rel.startsWith("..")`. An absolute path like `/tmp/video.mp4` resolves to a path that is still outside `process.cwd()`, so `rel` will start with `..` and be blocked. However, a path that is exactly `process.cwd()` itself (e.g., `"."`) would return `null` (valid). This edge case is harmless but worth documenting. More critically, `relative()` on Windows can return a path without `..` for paths on different drives — not a concern on macOS/Linux but worth noting if the codebase ever targets Windows.
- [ ] `outPath` uses `basename(filename)` to strip directory components (lines 511–513): this correctly prevents path traversal in the output filename. However, if `filename` contains only a bare name with no extension-like component, `basename` returns the full string unchanged, which is correct. No bug — but the safety depends on `basename` being called, which it is.
- [x] `imagesToVideo` does not validate `inputPattern` against path traversal (lines 789–793): when `inputPattern` is provided, it is passed directly to ffmpeg's `-i` argument (or `-pattern_type glob -i`). A glob pattern like `../../etc/*` would instruct ffmpeg to read files outside the working directory. Add `validateInputPath` for the base directory of `inputPattern`, or at minimum reject patterns starting with `..` or `/`.
- [x] `concatenate` and `imagesToVideo` write temporary files to `DOWNLOADS_DIR` using `Date.now()` as a suffix (lines 712, 765). If two concurrent calls happen within the same millisecond, they will write to the same temp file path, corrupting each other's concat lists. Use a UUID or a random suffix instead of `Date.now()`.
- [ ] `executeTool` switch has no `default` branch (lines 416–502): returns `undefined` for unknown names, which is correct per convention. No fix needed.
- [x] `dirEnsured` flag (lines 10, 524–528): this instance-level flag means the downloads directory is only created once per plugin instance. If the directory is deleted at runtime, subsequent calls will fail with a confusing ffmpeg error rather than a clear directory-creation error. Either remove the flag and always call `ensureDownloadsDir`, or catch the missing-directory error gracefully in each operation.

## Refactoring / Code Quality
- [ ] `DOWNLOADS_DIR = "downloads"` (line 6) is duplicated from `YtDlpPlugin.ts`. Extract to a shared constant (e.g., `src/paths.ts`).
- [x] `stem(filePath)` (lines 505–509): re-implements what `basename(filePath, extname(filePath))` does in one call. Replace with the stdlib equivalent.
- [ ] The `buildAtempoChain` function (lines 981–994) is defined at module scope outside the class, which is fine, but is not exported. If this logic is ever needed elsewhere (e.g., an audio-only speed filter), it would need to be duplicated. Consider exporting it or moving it to a shared utilities file.
- [ ] Several methods (`trim`, `convert`, `extractAudio`, `resize`, `addAudio`, `screenshot`, `extractFrames`, `crop`, `speed`, `rotate`) share an identical pattern: validate path → compute output path → log → try/catch ffmpeg call → return structured result. This boilerplate could be extracted into a private `runFfmpeg(label, inputFile, outputFile, buildArgs)` helper to reduce repetition across ~10 methods.
- [x] `ffmpeg_images_to_video` tool definition has `required: []` (line 231): neither `input_pattern` nor `input_files` is marked required, so an LLM could call the tool with neither, which is caught at line 741 but only at runtime. Adding a note in the description that at least one must be provided would help the LLM avoid the error.

## Security
- [x] `inputPattern` path traversal (line 791–793): as noted in Bug Fixes, a glob pattern with `..` components can cause ffmpeg to read files outside the working directory. This is a **High** severity finding because it allows read access to arbitrary paths on the filesystem when the tool is invoked by an LLM.
- [ ] `videoFilter` and `audioFilter` strings in `speed` (lines 928–929) are constructed from numeric inputs and passed as a single `-vf`/`-af` argument: since `speedFactor` is validated as a number in `[0.25, 4.0]` before use (line 918), and `buildAtempoChain` only emits numeric filter parameters, this is safe.
- [ ] `cropFilter` in `crop` (line 899) is constructed from four numeric parameters: `crop=${width}:${height}:${x}:${y}`. Since these are typed as `number`, they cannot contain shell metacharacters. Safe.
- [ ] `scale` in `resize` (line 670) is constructed from two numbers. Safe.
- [ ] `stderr` from ffmpeg is returned directly in error responses (e.g., line 604): may expose internal paths, codec details, or system information. Acceptable for a developer-facing tool, but should be noted.
- [ ] The plugin shells out to `ffmpeg` and `ffprobe` binaries, which must be in `PATH`. There is no validation that the resolved binary is the expected one. This is standard practice for CLI wrappers and is acceptable given the controlled deployment environment.

## Performance
- [ ] `getInfo` calls `ffprobe` as a subprocess for every invocation (line 536). No caching of probe results. For workflows that inspect the same file multiple times (e.g., `get_info` then `trim`), this incurs redundant process overhead. Low impact in practice.
- [ ] `concatenate` and `imagesToVideo` use the concat demuxer with `-c copy` (lines 721, 772), which avoids re-encoding. This is optimal. No concern.
- [ ] No timeout is set on any ffmpeg subprocess call. Long video operations can run indefinitely. For interactive agent use this is a UX concern (the agent will appear frozen). Consider a configurable operation timeout.

## Consistency / Style Alignment
- [ ] All tool methods return `{ success: true, output_file: string }` or `{ success: false, error: string }` consistently. `getInfo` returns `{ success: true, duration_seconds, ... }` without `output_file`. This is intentional and documented in the tool descriptions.
- [ ] `logger.debug` and `logger.error` are used consistently throughout. All log messages include the `"FFmpeg"` tag.
- [ ] The `rotation` parameter accepts both string and integer forms (`"90"`, `90`, etc.) via a JSON Schema enum (line 400): the implementation normalises to `String(rotation)` (line 962) before the `filterMap` lookup. This is correct and handles both cases.
- [ ] `executeTool` uses `switch` (line 417), unlike TMDBPlugin which uses `if` chains. Either is fine; the `switch` is preferable for readability given the large number of cases.
- [ ] `args: any` in `executeTool` (line 416) is consistent with the plugin interface contract.

## Notes
- FFmpegPlugin is the largest plugin in the codebase by line count (~995 lines) and exposes the most tools (13). The high surface area increases the chance of missing edge cases. The `inputPattern` traversal issue (Security section) is the most critical finding across all five reviewed plugins.
- The `dirEnsured` optimisation is a subtle statefulness concern: if `downloads/` is deleted between two separate tool calls, the second will fail silently inside ffmpeg with a confusing error message.
- Cross-module concern: `YtDlpPlugin` writes files to the same `downloads/` directory. The two plugins share this directory but neither coordinates with the other. An output filename collision between yt-dlp and ffmpeg operations is possible if the same stem is used.
- Cross-module concern: `buildAtempoChain` correctly handles atempo's [0.5, 2.0] range restriction by chaining filters. Reviewers of audio-related plugins should be aware this helper exists here.
- The plugin requires both `ffmpeg` and `ffprobe` in PATH. Only `ffprobe` is used in `getInfo`; all other methods use `ffmpeg`. The plugin does not check at init time whether these binaries are present.
