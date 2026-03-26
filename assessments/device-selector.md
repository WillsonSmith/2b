# DeviceSelector Assessment

## Module Overview

`deviceSelector.ts` is a macOS-specific interactive utility for discovering and selecting FFmpeg `avfoundation` audio and video devices at startup. It invokes `ffmpeg` with the `-list_devices` flag, parses the stderr output to enumerate available devices, then prompts the user via stdin to choose a device by numeric ID.

It exists because macOS `avfoundation` devices are referenced by index (e.g., `0` for video, `:0` for audio), and the indices differ between machines and can change when devices are connected or disconnected. Manually hardcoding a device index would be fragile; this module provides a one-time interactive selection at process startup.

## Interface / Exports

### `Device` (interface)

```typescript
export interface Device {
  id: string;    // Numeric index as a string, e.g. "0", "1"
  name: string;  // Human-readable device name, e.g. "FaceTime HD Camera"
}
```

### `scanDevices()` (async function)

```typescript
export async function scanDevices(): Promise<{ videoDevices: Device[]; audioDevices: Device[] }>
```

Spawns `ffmpeg -f avfoundation -list_devices true -i ""` and parses its stderr output to enumerate all available video and audio devices. Returns two arrays of `Device` objects.

### `selectVideoDevice(devices?: Device[])` (async function)

```typescript
export async function selectVideoDevice(devices?: Device[]): Promise<string>
```

Prints the list of video devices to the logger, prompts the user to enter a device ID, and returns the chosen ID as a plain string (default `"0"` if empty input). If `devices` is not provided, calls `scanDevices()` internally.

### `selectAudioDevice(devices?: Device[])` (async function)

```typescript
export async function selectAudioDevice(devices?: Device[]): Promise<string>
```

Same as `selectVideoDevice` but for audio devices. Returns the chosen ID formatted with a leading colon (e.g., `:0`, `:1`). The colon prefix is the `avfoundation` format for audio-only device references, matching what `AudioProvider` expects.

### `selectDevices()` (async function)

```typescript
export async function selectDevices(): Promise<{ videoDeviceId: string; audioDeviceId: string }>
```

Convenience function that calls `scanDevices()` once, then calls `selectVideoDevice()` and `selectAudioDevice()` in sequence using the shared scan result. Returns both selected IDs.

## Configuration

### External Dependencies

- **`ffmpeg`** must be installed and on `PATH`. The binary is invoked via `Bun.spawn`.
- **macOS `avfoundation`**: The `-f avfoundation -list_devices true` flag combination is macOS-specific. Not portable to Linux or Windows.
- **No environment variables**: No configuration is read from environment.
- **`prompt()` global**: Uses Bun's built-in `prompt()` function (synchronous stdin prompt). This blocks the event loop until the user provides input, which is intentional for startup-time device selection.

## Data Flow

```
Bun.spawn(["ffmpeg", "-f", "avfoundation", "-list_devices", "true", "-i", '""'])
    ↓ (stderr captured as pipe, stdout ignored)
new Response(proc.stderr).text() → full stderr output string
    ↓
Split by "\n" → iterate lines
    ↓
Category detection:
  "AVFoundation video devices:" → currentCategory = "video"
  "AVFoundation audio devices:" → currentCategory = "audio"
    ↓
Regex match: /\[(\d+)\]\s+(.+)$/
  capture group 1: numeric ID string
  capture group 2: device name
    ↓
Push to videoDevices[] or audioDevices[] based on currentCategory
    ↓
Return { videoDevices, audioDevices }
    ↓ (in selectVideoDevice / selectAudioDevice)
Log device list via logger.info
    ↓
prompt("Select ... Device ID (default 0):")
    ↓
Return trimmed choice, or "0" as default
  (audio: prepend ":" → ":N")
```

## Code Paths

### `scanDevices()`

1. Logs "Scanning for available video and audio devices..."
2. Spawns `ffmpeg` with `stderr: "pipe"`, `stdout: "ignore"`. The device list is printed to stderr by ffmpeg (a quirk of how ffmpeg handles device listing).
3. Reads the entire stderr stream as text via `new Response(proc.stderr).text()`. This awaits the process completing.
4. Splits on `"\n"` and iterates each line:
   - Detects the `"AVFoundation video devices:"` header — sets `currentCategory = "video"`.
   - Detects the `"AVFoundation audio devices:"` header — sets `currentCategory = "audio"`.
   - Applies regex `/\[(\d+)\]\s+(.+)$/` to find device entries. On match, pushes `{ id: match[1], name: match[2].trim() }` to the appropriate array.
5. Returns `{ videoDevices, audioDevices }`.

### `selectVideoDevice(devices?)`

1. If no `devices` provided, calls `scanDevices()` and uses `.videoDevices`.
2. Logs all devices with their IDs.
3. Calls `prompt("Select Video Device ID (default 0):")` — blocks until user input.
4. Returns `videoChoice?.trim() || "0"`. Empty input or `null` (EOF) defaults to `"0"`.

### `selectAudioDevice(devices?)`

1. Same as `selectVideoDevice` but for audio devices.
2. Returns `:${audioChoice?.trim() || "0"}` — prepends a colon. The `avfoundation` driver uses the format `N:M` for combined video+audio, or just `:M` for audio-only. `AudioProvider` expects the `:M` format.

### `selectDevices()`

1. Calls `scanDevices()` once to get both device lists.
2. Calls `selectVideoDevice(videoDevices)` and `selectAudioDevice(audioDevices)` sequentially, passing the pre-fetched lists.
3. Returns `{ videoDeviceId, audioDeviceId }`.

## Helper Functions / Internals

None. All logic is in the four exported functions. There are no private helpers.

## Error Handling

- **`ffmpeg` not found**: `Bun.spawn` would throw if `ffmpeg` is not on PATH. The error propagates to the caller with no custom handling.
- **ffmpeg non-zero exit code**: `ffmpeg -list_devices` intentionally exits with a non-zero code (no real input is provided). The exit code is never checked — only the stderr text is consumed. This is correct for the listing use case.
- **No devices found**: If parsing yields empty arrays, `selectVideoDevice`/`selectAudioDevice` log an empty list and still prompt. The user could enter `0`, which may or may not correspond to a real device.
- **`prompt()` returns `null`**: `prompt()` returns `null` on EOF (e.g., non-interactive stdin). The expression `videoChoice?.trim() || "0"` handles this — `null?.trim()` is `undefined`, and `undefined || "0"` gives the string `"0"`.
- **No validation of user input**: The returned device ID is passed directly to `AudioProvider`, which performs its own `validateDeviceId` regex check. If the user enters an unexpected value, `AudioProvider.start()` throws.
- **Parsing failures are silent**: Lines that do not match the category headers or the device regex are silently skipped. Unexpected ffmpeg output formats produce empty arrays with no error.

## Integration Context

`selectAudioDevice` is the only function currently used in the codebase:

```typescript
// MicrophoneInputSource.ts
new AudioProvider(await selectAudioDevice())
```

`selectDevices()` and `selectVideoDevice()` are exported but not imported anywhere in the current codebase — they appear intended for a future vision/camera input source based on the `videoDeviceId` return value.

## Observations / Notes

- **`stdout: "ignore"` with stderr captured**: `ffmpeg -list_devices` outputs device info to stderr, not stdout. The code correctly captures stderr as a pipe and ignores stdout. This is a slightly surprising but correct arrangement dictated by ffmpeg's behavior.
- **`-i '""'`**: The empty quoted string passed as the `-i` argument is a dummy input to satisfy ffmpeg's argument parser. ffmpeg requires an `-i` argument to run; the empty string causes it to fail, but the device listing happens before the failure is reported. This is a standard ffmpeg idiom for listing devices.
- **Process exit not explicitly awaited**: `new Response(proc.stderr).text()` awaits the full stderr stream, which implicitly waits for the process to exit. However, there is no `await proc.exited` or exit code check. Non-zero exit is silently ignored.
- **`currentCategory` starts as `""`**: If any device lines appear before the `"AVFoundation video devices:"` header (which should not happen in practice), they would not match either category and would be silently dropped.
- **Regex `/\[(\d+)\]\s+(.+)$/`**: Matches lines ending with `[N] Device Name`. Lines are already split by `"\n"` before the regex is applied, so `$` effectively matches end-of-string for each line. The `+` after `.` requires at least one character for the device name.
- **Audio ID format asymmetry**: Video IDs are returned as plain numbers (`"0"`, `"1"`), while audio IDs are returned with a colon prefix (`":0"`, `":1"`). This asymmetry is deliberate — `avfoundation` uses `:N` for audio-only streams. `AudioProvider.validateDeviceId` permits the colon character.
- **Blocking `prompt()`**: Intentional for an interactive startup flow, but this makes `selectAudioDevice` and `selectDevices` unsuitable for non-interactive contexts (automated tests, headless server deployments).
- **`selectDevices()` sequential prompting**: The video prompt must complete before the audio prompt appears. This is correct for a CLI flow.
