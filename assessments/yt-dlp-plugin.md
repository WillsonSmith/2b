# YtDlpPlugin Assessment

## Module Overview

YtDlpPlugin allows agents to download specific time-range clips from video URLs using the `yt-dlp` command-line tool. Given a URL (YouTube, Twitch VOD, or any yt-dlp-supported source), a start timestamp, and an end timestamp, it spawns `yt-dlp` with section-download and keyframe-alignment flags and saves the resulting file to a `downloads/` directory. It returns a structured result indicating success or failure, the resolved output filename, and the normalised timestamps.

The plugin exists to support the media sub-agent's video clip extraction capability — a common task when working with long-form video content like stream VODs.

## Interface / Exports

```typescript
export class YtDlpPlugin implements AgentPlugin
```

**Constructor**

No constructor is defined; the default no-arg constructor is used.

**Implemented AgentPlugin hooks**

| Hook | Returns |
|---|---|
| `getSystemPromptFragment()` | Explains the tool, its timestamp format requirements, and the download directory |
| `getTools()` | One tool definition: `download_video_clip` |
| `executeTool(name, args)` | Delegates `download_video_clip` to `this.downloadClip(...)` |

**Tool: `download_video_clip`**

- **Parameters**:
  - `url` (string, required) — the video URL.
  - `start_time` (string, required) — start timestamp, `HH:MM:SS` or `MM:SS`.
  - `end_time` (string, required) — end timestamp, same format.
  - `output_filename` (string, optional) — filename without extension; defaults to `"%(title)s [start_end]"`.
- **Returns**: `{ success: true, url, start_time, end_time, output_file, message }` on success, or `{ success: false, error }` on failure.

## Configuration

- **`yt-dlp` must be installed and on PATH**: The plugin calls `yt-dlp` via Bun's shell operator (`$`). If `yt-dlp` is not available, every call will fail.
- **`DOWNLOADS_DIR` constant**: `"downloads"` — hardcoded module-level constant. The downloads directory is relative to the process working directory. It is not created automatically; if the directory does not exist, `yt-dlp` may create it or fail depending on the platform.
- **No environment variables**.
- **No constructor options**.
- **External tool dependency**: `yt-dlp` (external binary, not an npm package).
- **Import**: Uses `$` from `"bun"` (Bun's shell template literal) and `join` from `"node:path"`.

## Data Flow

```
LLM calls download_video_clip {
  url: "https://www.twitch.tv/videos/12345",
  start_time: "1:05:05",
  end_time: "1:10:04",
  output_filename: "highlight_clip"
}
  → executeTool("download_video_clip", args)
    → downloadClip(url, "1:05:05", "1:10:04", "highlight_clip")
      → normalizeTimestamp("1:05:05") → "01:05:05"
      → normalizeTimestamp("1:10:04") → "01:10:04"
      → section = "*01:05:05-01:10:04"
      → outputTemplate = "downloads/highlight_clip.%(ext)s"
      → $`yt-dlp --download-sections *01:05:05-01:10:04
                 --force-keyframes-at-cuts
                 -o downloads/highlight_clip.%(ext)s
                 https://www.twitch.tv/videos/12345`.text()
      → parse stdout for "[download] Destination: ..." or "[Merger] Merging formats into ..."
      → return { success: true, url, start_time, end_time, output_file, message }
```

## Code Paths

### Happy path

1. `executeTool` receives `name === "download_video_clip"` and calls `downloadClip`.
2. Both timestamps are normalised to `HH:MM:SS` via `normalizeTimestamp`.
3. The yt-dlp `--download-sections` argument is built as `"*{start}-{end}"` (the `*` prefix is yt-dlp syntax for time ranges).
4. The output template is constructed:
   - If `output_filename` is provided: `downloads/{output_filename}.%(ext)s`
   - Otherwise: `downloads/%(title)s [{start-with-dashes}_{end-with-dashes}].%(ext)s`
5. `$\`yt-dlp ...\`.text()` is awaited. Bun's `$` operator runs the command and captures all stdout as a string.
6. The debug log captures yt-dlp's full output.
7. The output string is scanned for two regex patterns to determine the actual filename:
   - `[Merger] Merging formats into "..."` — used when yt-dlp downloads and merges separate audio/video streams.
   - `[download] Destination: ...` — used for single-stream downloads.
   - Falls back to `outputTemplate` if neither matches.
8. Returns the success object with the resolved filename.

### yt-dlp failure

If `yt-dlp` exits with a non-zero code, Bun's `$` shell operator throws. The catch block reads `err?.stderr ?? err?.message ?? String(err)` to extract the error text, logs it at error level, and returns `{ success: false, error: "yt-dlp failed: ..." }`.

### Timestamp normalisation

`normalizeTimestamp` handles two cases:
- **2 parts** (`MM:SS`): Prepends `"00:"` to form `HH:MM:SS`, padding each part to 2 digits.
- **3 parts** (`HH:MM:SS`): Pads each part to 2 digits.
- **Other** (1 part, 4+ parts): Returns the input unchanged. No validation is done for malformed timestamps in this fallback.

### Unknown tool name

`executeTool` returns `undefined` implicitly for names other than `"download_video_clip"`.

## Helper Functions / Internals

### `private normalizeTimestamp(ts: string): string`

Normalises user-provided timestamps to `HH:MM:SS` format for yt-dlp compatibility. Splits on `:`, inspects the number of parts, and pads with `padStart(2, "0")`. The colons in normalised timestamps are later replaced with hyphens when building the auto-generated output filename (`:` is not a valid filename character on Windows/macOS).

### `private async downloadClip(url, startTime, endTime, outputFilename?)`

The main implementation method. Calls `normalizeTimestamp` on both timestamps, builds the yt-dlp command, executes it via Bun's `$`, parses the output for the destination filename, and returns the result object. Not exported.

## Error Handling

| Scenario | Handling |
|---|---|
| yt-dlp exits non-zero | Caught; `err.stderr` or `err.message` placed in error string; returns `{ success: false, error }` |
| yt-dlp not found on PATH | Caught by the same catch block; error string will reflect the OS "not found" message |
| Malformed timestamp (1 or 4+ parts) | Passed through unchanged to yt-dlp, which may reject it |
| `downloads/` directory does not exist | Handled by yt-dlp itself (it typically creates parent directories); if not, yt-dlp's error is caught |
| Unknown tool name | Returns `undefined` silently |

Errors are returned as structured `{ success: false, error }` objects rather than thrown, so the LLM receives the failure details and can report them to the user.

## Integration Context

YtDlpPlugin is registered in the **media sub-agent** (`src/agents/sub-agents/createMediaAgent.ts`), alongside `FFmpegPlugin` and `ImageVisionPlugin`. The media agent is a `HeadlessAgent` with the persona "media processing specialist."

The media sub-agent is designed for video-centric tasks. YtDlpPlugin handles acquisition (downloading), FFmpegPlugin handles post-processing (editing, conversion, extraction), and ImageVisionPlugin handles analysis.

Call chain:

```
User → CortexAgent
  → SubAgentPlugin.executeTool("media_agent", { task })
    → HeadlessAgent.ask(task)
      → YtDlpPlugin.executeTool("download_video_clip", { url, start_time, end_time })
```

No other module imports YtDlpPlugin.

## Observations / Notes

- **`yt-dlp` must be pre-installed**: The plugin has a hard runtime dependency on the external `yt-dlp` binary. There is no check at plugin initialisation or at `executeTool` call time for whether `yt-dlp` is available — the failure will only surface when the tool is actually called, at which point the catch block will return an error message that mentions the OS-level "command not found" error.
- **Bun's `$` operator vs `Bun.spawn`**: Unlike ShellPlugin which uses `Bun.spawn` to avoid shell interpretation, YtDlpPlugin uses Bun's `$` shell template literal. This means the arguments are passed through a shell, and special characters in `url`, `section`, or `outputTemplate` could potentially be interpreted. In practice yt-dlp URLs and timestamps are well-constrained, but there is no sanitisation of the `output_filename` parameter.
- **`output_filename` injection risk**: The optional `output_filename` parameter is inserted directly into the shell template string. A value containing shell metacharacters (backticks, `$(`, `&&`, etc.) would be executed by the shell. Since this value comes from the LLM, a sufficiently crafted prompt could trigger command injection. ShellPlugin avoids this by using `Bun.spawn` with an argument array; YtDlpPlugin does not have the same protection.
- **Output filename detection is heuristic**: The plugin parses yt-dlp's stdout to determine the output filename. This works for standard downloads but could fail silently if yt-dlp's output format changes between versions. The fallback to `outputTemplate` ensures the return value always has a non-null `output_file`, but the template string contains `%(ext)s` (an unexpanded yt-dlp variable), which would be misleading to return as the actual path.
- **`--force-keyframes-at-cuts`**: This flag tells yt-dlp to re-encode the start and end of the clip to align with the requested timestamps. Without it, video clips start and end at the nearest keyframe, which can be several seconds off. This is a good default choice for accuracy, but it adds processing time and may require FFmpeg to be installed alongside yt-dlp.
- **No input URL validation**: Unlike WebReaderPlugin, there is no check that the URL is safe before passing it to yt-dlp. yt-dlp supports many protocols beyond HTTP/HTTPS (including local file paths). A `file://` URL would cause yt-dlp to attempt to process a local file. This is a potential concern if the plugin is used in a context where untrusted input reaches it.
- **Relative downloads directory**: `DOWNLOADS_DIR = "downloads"` is relative to the process working directory at the time yt-dlp runs. If the agent process changes its CWD, or if the process CWD is unexpected, downloads will be placed in an unintended location.
- **Non-zero exit code detection**: Bun's `$` throws when the process exits non-zero, which is how yt-dlp failures are caught. However, some yt-dlp warnings also produce non-zero-ish output without failing. In practice yt-dlp's exit codes are well-defined (0 = success), so this is reliable.
