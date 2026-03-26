# FFmpegPlugin Assessment

## Module Overview

`FFmpegPlugin` gives the agent full video editing capabilities by wrapping the `ffmpeg` and `ffprobe` command-line tools in a set of 13 structured tool calls. The plugin handles metadata inspection, trimming, format conversion, audio extraction, resizing, concatenation, image-to-video assembly, audio muxing, frame extraction, screenshot capture, cropping, speed adjustment, and rotation/flipping. All output files are written to a `downloads/` directory relative to the working directory. Input files must be within the working directory (path traversal is blocked). The plugin delegates the actual encoding work entirely to the system `ffmpeg`/`ffprobe` binaries and does no media processing of its own.

## Interface / Exports

### `class FFmpegPlugin implements AgentPlugin`

| Member | Signature | Purpose |
|---|---|---|
| `name` | `string = "FFmpeg"` | Plugin identifier |
| `getSystemPromptFragment()` | `() => string` | Injects a summary of available video tools and file path conventions into the system prompt |
| `getTools()` | `() => ToolDefinition[]` | Returns 13 tool definitions (see below) |
| `executeTool(name, args)` | `async (name, args) => Promise<any>` | Switch-dispatches to private operation methods |

### Registered Tools

| Tool name | Required args | Output |
|---|---|---|
| `ffmpeg_get_info` | `input_file` | `{ success, duration_seconds, size_bytes, bitrate_kbps, format, video, audio }` |
| `ffmpeg_trim` | `input_file, start_time, end_time` | `{ success, output_file }` |
| `ffmpeg_convert` | `input_file, output_format` | `{ success, output_file }` |
| `ffmpeg_extract_audio` | `input_file` | `{ success, output_file }` |
| `ffmpeg_resize` | `input_file, width, height` | `{ success, output_file }` |
| `ffmpeg_concatenate` | `input_files` (array) | `{ success, output_file }` |
| `ffmpeg_images_to_video` | none required (at least one of pattern/files) | `{ success, output_file }` |
| `ffmpeg_add_audio` | `video_file, audio_file` | `{ success, output_file }` |
| `ffmpeg_extract_frames` | `input_file` | `{ success, output_pattern }` |
| `ffmpeg_screenshot` | `input_file, timestamp` | `{ success, output_file }` |
| `ffmpeg_crop` | `input_file, width, height` | `{ success, output_file }` |
| `ffmpeg_speed` | `input_file, speed` | `{ success, output_file }` |
| `ffmpeg_rotate` | `input_file, rotation` | `{ success, output_file }` |

## Configuration

| Dependency | Notes |
|---|---|
| `ffmpeg` | Must be in system PATH; used by all write operations |
| `ffprobe` | Must be in system PATH; used by `ffmpeg_get_info` |
| `DOWNLOADS_DIR` | Hardcoded to `"downloads"` (relative to process cwd) |

No environment variables. No constructor arguments. No external library dependencies beyond Bun built-ins and `node:path`.

## Data Flow

```
Agent tool call → executeTool(name, args)
  → switch dispatch → private method
  → validateInputPath(filePath)  [path traversal check]
  → ensureDownloadsDir()         [mkdir -p downloads/]
  → Bun.$ ffmpeg/ffprobe command [subprocess]
  → parse or pipe output
  → return { success: true/false, output_file/error }
```

For `ffmpeg_get_info`: ffprobe JSON is parsed in-process to extract structured stream and format data.

For `ffmpeg_concatenate` and `ffmpeg_images_to_video` (file list mode): a temporary concat list file is written to `downloads/_concat_list_<timestamp>.txt` or `downloads/_images_list_<timestamp>.txt`, fed to ffmpeg, then deleted.

## Code Paths

### `getInfo`
1. Validates input path.
2. Runs `ffprobe -v quiet -print_format json -show_streams -show_format <file>`.
3. Parses JSON; finds first video stream and first audio stream.
4. Computes FPS from the `r_frame_rate` fraction string (e.g., `"30000/1001"` → `~29.97`).
5. Returns a structured object with `duration_seconds`, `size_bytes`, `bitrate_kbps`, `format`, `video`, `audio`.

### `trim`
Uses `-ss <start> -to <end> -c copy` — stream copy, no re-encoding. Very fast for most formats.

### `convert`
Defaults video and audio codecs to `"copy"` if not specified. The caller can pass explicit codec names (e.g., `"libx264"`).

### `extractAudio`
Runs `ffmpeg -vn` to strip video streams. Format defaults to `"mp3"`.

### `resize`
Uses `-vf scale=W:H`. Supports `-1` for dimension-preserving aspect ratio (FFmpeg convention).

### `concatenate`
1. Guards against fewer than 2 input files.
2. Validates all paths.
3. Writes an ffmpeg concat list file with proper single-quote escaping (backslash + single-quote).
4. Runs `ffmpeg -f concat -safe 0 -c copy`.
5. Cleans up the list file regardless of success or failure.

### `imagesToVideo`
Two sub-paths:
- **File list mode** (when `input_files` is provided): writes a concat list, uses `-f concat -r <fps>` with `-pix_fmt yuv420p`.
- **Pattern mode**: detects whether `input_pattern` contains glob metacharacters (`*?[]{}`) via regex, then uses either `-pattern_type glob -i <pattern>` or raw `-i <pattern>` (for numbered sequences like `frame_%04d.png`).

### `addAudio`
Maps `0:v:0` from video and `1:a:0` from audio file. Copies video stream, re-encodes audio. Applies `-shortest` by default.

### `extractFrames`
Uses `-vf fps=<N>` to extract frames at a given rate. Output uses a `%04d` sequence pattern.

### `screenshot`
Uses `-ss <timestamp> -frames:v 1` to grab a single frame. Note: `-ss` is placed before `-i` for fast keyframe seek; this may not be frame-exact for files with infrequent keyframes.

### `crop`
Uses `-vf crop=W:H:X:Y` filter.

### `speed`
1. Validates speed is in `[0.25, 4.0]`.
2. Video: `setpts=1/speed*PTS` filter.
3. Audio: `buildAtempoChain(speed)` to chain multiple `atempo` filters.
4. Does not use `-c copy` — full re-encode required.

### `rotate`
Uses a static `filterMap` that maps string representations to ffmpeg vf filter strings. Audio is always copied (`-c:a copy`).

## Helper Functions / Internals

### `stem(filePath: string): string` (private)
Extracts the filename without extension from a path. Used to derive default output filenames.

### `outPath(filename: string, ext: string): string` (private)
Joins `DOWNLOADS_DIR / <basename(filename)>.<ext>`. Strips directory components from the filename argument to prevent subdirectory creation inside downloads.

### `validateInputPath(filePath: string): string | null` (private)
Resolves the path against `process.cwd()` and checks that the relative path does not start with `..`. Returns an error string if invalid, `null` if safe. Does not check file existence.

### `ensureDownloadsDir(): Promise<void>` (private)
Creates the `downloads/` directory if it does not exist, using `Bun.$ mkdir -p`. The `dirEnsured` flag prevents redundant calls.

### `buildAtempoChain(speed: number): string` (module-level)
FFmpeg's `atempo` filter only accepts values in `[0.5, 2.0]`. For speeds outside this range, the function chains multiple `atempo` filters (e.g., speed of 4.0 becomes `atempo=2.0,atempo=2.0`). Handles both fast (> 2.0) and slow (< 0.5) cases via two while loops. Example: speed `0.25` produces `atempo=0.5,atempo=0.5`.

## Error Handling

All ffmpeg/ffprobe operations use try-catch. On failure:
- `logger.error("FFmpeg", ...)` logs the stderr.
- Returns `{ success: false, error: <stderr string> }`.

For `ffmpeg_get_info`, errors are caught similarly with `{ success: false, error: "ffprobe failed: ..." }`.

Path validation errors return `{ success: false, error: "<path> is outside the working directory." }` without touching the filesystem.

The `concatenate` and `imagesToVideo` methods clean up temporary list files in both success and failure paths (the failure path uses `.catch(() => {})` to swallow secondary cleanup errors).

`speed()` returns `{ success: false, error: "Speed must be between 0.25 and 4.0." }` for out-of-range values before spawning any process.

`rotate()` returns `{ success: false, error: "Unknown rotation '...'" }` for unrecognized rotation values.

## Integration Context

**Registered in:** `src/agents/sub-agents/createMediaAgent.ts` alongside `YtDlpPlugin` and `ImageVisionPlugin`.

```typescript
new HeadlessAgent(llm, [new YtDlpPlugin(), new FFmpegPlugin(), new ImageVisionPlugin()], ...)
```

**Depends on:**
- `src/core/Plugin.ts` — `AgentPlugin`, `ToolDefinition`
- `src/logger.ts` — debug/error logging
- `bun` (`$` shell tag, `Bun.write`)
- `node:path` — `join`, `basename`, `extname`, `resolve`, `relative`
- System: `ffmpeg`, `ffprobe`

**Companion plugins:** `YtDlpPlugin` downloads video clips into `downloads/`, which `FFmpegPlugin` can then edit. `ImageVisionPlugin` can analyze frames extracted by `ffmpeg_extract_frames`.

## Observations / Notes

1. **Path validation does not check file existence:** `validateInputPath` blocks traversal but does not confirm the file exists. ffmpeg will produce a descriptive error in stderr if the file is missing, surfaced back to the LLM as `{ success: false, error: ... }`.

2. **`ffmpeg_screenshot` uses fast seek:** Placing `-ss` before `-i` causes ffmpeg to seek to the nearest keyframe before the timestamp. The screenshot may be slightly before the requested time for files with infrequent keyframes. Placing `-ss` after `-i` would be frame-accurate but much slower.

3. **`ffmpeg_images_to_video` has empty `required` array:** Both `input_pattern` and `input_files` are optional in the schema. The runtime guard inside the method returns an error if neither is provided, but the LLM schema does not communicate this constraint upfront.

4. **`dirEnsured` flag is not reset if the directory is deleted at runtime:** The flag is an optimization (`mkdir -p` is idempotent), but if `downloads/` is removed while the agent is running, subsequent calls skip the mkdir attempt and ffmpeg will fail to write output files.

5. **`buildAtempoChain` division for slow speeds:** The remaining-value division (`remaining /= 0.5`) multiplies remaining by 2 each iteration, correctly building the chain. For example, speed `0.25` produces `atempo=0.5,atempo=0.5`.

6. **`rotation` parameter accepts both string and integer in JSON schema:** The enum includes both `"90"` and `90`, etc. The filter map uses `String(rotation)` to normalize, so both forms work correctly.

7. **No re-encode quality settings:** For operations that re-encode (convert, resize, speed, crop), no quality parameters (`-crf`, `-b:v`, etc.) are specified. ffmpeg uses its defaults, which may not match expectations for quality-sensitive workflows.

8. **`ffmpeg_concatenate` requires compatible codecs:** The system prompt notes this requirement. If input files have different codecs, `-c copy` will silently produce a broken output or fail. The recommended workflow is to use `ffmpeg_convert` first.
