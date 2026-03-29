# Assessment: YtDlpPlugin
**File:** src/plugins/YtDlpPlugin.ts
**Reviewed:** 2026-03-28
**Risk level:** High

## Bug Fixes
- [x] `executeTool` returns `undefined` for unknown tool names (lines 52–61): The method has no explicit `return undefined` fallback. While JavaScript implicitly returns `undefined` when the `if` block is not entered, the plugin convention documented in `src/plugins/CLAUDE.md` states "Return `undefined` (not throw) from `executeTool` for unknown tool names so other plugins can handle them." Add an explicit `return undefined` after the `if` block to make intent clear and avoid any ambiguity if the method signature changes.
- [x] `normalizeTimestamp` silently returns the raw input string when the part count is not 2 or 3 (line 72): A malformed timestamp like `"5"`, `"1:2:3:4"`, or an empty string will pass through unmodified and be fed directly to `yt-dlp` via the `--download-sections` flag. yt-dlp will likely error, but the error message will be confusing. Add validation that rejects inputs that do not match the expected format and surfaces a clear error before shelling out.
- [x] `downloadClip` does not ensure the `downloads/` directory exists before invoking yt-dlp (lines 75–119): If the directory does not exist, yt-dlp will fail with a file-not-found error. FFmpegPlugin has the same issue but at least has a `dirEnsured` guard. Add a `Bun.mkdir(DOWNLOADS_DIR, { recursive: true })` call (or equivalent) before the subprocess call.

## Refactoring / Code Quality
- [ ] `DOWNLOADS_DIR = "downloads"` (line 6) is duplicated from `FFmpegPlugin.ts`. The FFmpegPlugin assessment also flagged this. Extract to a shared constant in `src/paths.ts` to avoid the paths diverging silently. **SKIPPED: cross-module change; skill rules prohibit modifying files outside the target module.**
- [x] `args: any` in `executeTool` (line 52) is consistent with the plugin interface but means missing or wrong-typed arguments (e.g., `args.url` being `undefined`) are not caught until they hit `downloadClip`. Add a guard at the top of the `if` block to check that `url`, `start_time`, and `end_time` are non-empty strings before calling `downloadClip`.
- [x] The `outputFile.trim()` call appears twice in the return object (lines 108–109). Assign `outputFile.trim()` to a variable once and reuse it.
- [x] `getSystemPromptFragment` is a single multi-sentence string with no line breaks (lines 12–14). This is fine for a short fragment but the instruction "Timestamps should be in HH:MM:SS or MM:SS format" could be more precise — it does not tell the LLM that `MM:SS` means no leading zero on the minutes component is required, which may cause unnecessary retries.

## Security
- [x] `url` is passed directly as a shell argument to `yt-dlp` via Bun's tagged template literal `$` (line 94): `Bun.$` with template literal interpolation does **not** automatically shell-escape individual values — each interpolated value is treated as a single argument token (equivalent to execvp, not /bin/sh), so shell metacharacters in `url` cannot inject additional shell commands. However, `url` could still be a `file://` URI or a local path, causing yt-dlp to read from the local filesystem. Add a check that `url` starts with `http://` or `https://` before invoking yt-dlp.
- [x] `outputFilename` (user-supplied, optional) is incorporated into the output template via `join(DOWNLOADS_DIR, ...)` (line 89). `node:path`'s `join` will normalise `..` components, so `outputFilename = "../../etc/cron"` would resolve to a path outside `downloads/`. Apply `basename(outputFilename)` before passing it to `join` to strip directory components, matching the approach used by FFmpegPlugin.
- [ ] `stderr` from yt-dlp is returned in the error response (line 112): may expose internal system paths or cookies/session data if yt-dlp is configured with netrc or cookie files. Acceptable for a developer-facing tool, but should be noted.
- [ ] The plugin shells out to the `yt-dlp` binary, which must be in `PATH`. There is no check at init or call time that the binary exists. A missing binary will surface as an unhandled shell error rather than a clear plugin error.

## Performance
- [ ] No timeout is set on the `yt-dlp` subprocess call (line 93–94). Long VOD clips or slow network connections can cause the agent to block indefinitely. Consider a configurable `timeoutMs` option passed to the plugin constructor and applied via `$`'s timeout option, or at minimum document the lack of a timeout in the tool description.
- [ ] `--force-keyframes-at-cuts` (line 94) causes yt-dlp to re-encode the segment boundaries, which is slower than a straight demux copy but produces frame-accurate cuts. This is a deliberate accuracy/performance trade-off and is acceptable. No change needed.

## Consistency / Style Alignment
- [ ] The plugin uses `logger.debug` and `logger.error` consistently with the `"YtDlp"` tag (lines 81, 113), matching the convention used by all other plugins.
- [ ] Return shapes are consistent: `{ success: true, url, start_time, end_time, output_file, message }` on success and `{ success: false, error }` on failure. This matches the general pattern used by FFmpegPlugin and FileIOPlugin.
- [ ] `DOWNLOADS_DIR` is a module-level constant (line 6), consistent with FFmpegPlugin's approach. Both plugins use the same string `"downloads"` but define it independently — see Refactoring note above.
- [ ] The tool schema marks `output_filename` as optional and not in `required` (line 46), which is correct. The description accurately states it defaults to a sanitized title + timestamp range.
- [ ] The class has no `onInit` hook, which is appropriate since it performs no I/O at startup and does not need an agent reference. This follows the documented convention.

## Notes
- The two highest-severity findings are both security issues: (1) `outputFilename` path traversal via `..` components allows writing files outside `downloads/`, and (2) `url` acceptance of `file://` URIs allows yt-dlp to read local filesystem paths. Both require only small, targeted fixes.
- Cross-module concern: YtDlpPlugin and FFmpegPlugin both write to `downloads/` with no coordination. A yt-dlp output file and an FFmpeg output file could share the same stem if the video title matches an FFmpeg-generated filename. No locking or collision detection exists in either plugin.
- Cross-module concern: `DOWNLOADS_DIR = "downloads"` is defined independently in both `YtDlpPlugin.ts` and `FFmpegPlugin.ts`. If one is changed and the other is not, the two plugins will write to different directories silently. Centralising this in `src/paths.ts` (already flagged in the FFmpegPlugin assessment) would resolve this.
- The plugin requires `yt-dlp` to be installed and available in `PATH`. It does not check for this at `onInit` time. A first-call failure with a raw shell error is the only signal a user gets if yt-dlp is missing.
- The regex-based output filename extraction (lines 99–101) relies on yt-dlp's stdout format, which is not part of its public API and may change across yt-dlp versions. If the format changes, `outputFile` will fall back to `outputTemplate`, which is the template string (containing `%(ext)s`) rather than the actual resolved filename. This is a fragile heuristic worth noting for maintainers.
