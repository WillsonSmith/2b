# Assessment: deviceSelector
**File:** src/utils/deviceSelector.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] `scanDevices` does not await process exit before reading stderr (line 17): `new Response(proc.stderr).text()` consumes the pipe stream, but the process exit code is never checked and the process is never awaited (`proc.exited`). If ffmpeg exits with a non-zero code (e.g., device unavailable), the function silently returns empty arrays with no indication of failure. Fix: await `proc.exited` after reading stderr and throw or log if the exit code is non-zero.
- [x] Quoted empty string passed as `-i` argument causes ffmpeg to fail on some systems (line 12): The argument `'""'` passes a literal two-character string `""` rather than an empty string. ffmpeg interprets this as a filename, not an empty input. On some avfoundation versions this silently skips device listing. Fix: use `""` (empty string) as the argument value instead of `'""'`.
- [x] `selectVideoDevice` and `selectAudioDevice` do not validate that the user-supplied ID corresponds to an actual device (lines 55, 67): A user can type any string; if it does not match a valid device ID ffmpeg will fail downstream with a cryptic error. Fix: validate that the returned ID exists in the device list, or at minimum that it is a non-negative integer string.
- [x] `selectAudioDevice` always prepends `:` to the returned ID (line 67): This formatting couples the return value to ffmpeg's `avfoundation` device string format, but the caller may not expect this. If the caller later constructs a combined device string they will produce `:<id>` doubled. Fix: document this contract explicitly or move the `:` prefix to the call site.

## Refactoring / Code Quality
- [x] `selectVideoDevice` and `selectAudioDevice` are nearly identical (lines 47–69): Both functions list devices, prompt, and return an ID. The only differences are the label string, the device list, and the `:` prefix. Extract a private helper `selectDevice(label: string, devices: Device[], prefix?: string): Promise<string>` to eliminate duplication.
- [x] `let` used for `videoChoice` and `audioChoice` where `const` is appropriate (lines 54, 66): Neither variable is reassigned after declaration. Use `const`.
- [x] `scanDevices` has no error handling around the `spawn` call (line 12): If `ffmpeg` is not on PATH, `spawn` will throw synchronously and the error propagates as an unhandled rejection with no contextual message. Wrap in try/catch and rethrow with a descriptive message like `"ffmpeg not found; install FFmpeg and ensure it is on PATH"`.
- [x] The regex on line 34 (`/\[(\d+)\]\s+(.+)$/`) will match any line containing `[<digits>] <text>`, including ffmpeg diagnostic lines unrelated to device entries. This can pollute the device lists with spurious entries. A tighter pattern anchored to the known ffmpeg avfoundation output format (e.g., requiring the `[AVFoundation` prefix on preceding context) would be more robust.

## Security
- [x] No injection risk: the `spawn` call uses a fixed argument array with no user-supplied data at scan time. No issues found in `scanDevices`.
- [x] User input from `prompt()` is used directly as a device ID string passed to ffmpeg by callers (lines 55, 67): If callers interpolate the returned string into a shell command rather than passing it as an argument array element, command injection is possible. The module itself is safe, but the return value should be documented as untrusted/unvalidated so callers treat it accordingly.

## Performance
- [x] `scanDevices` is called twice when `selectDevices` is used indirectly via `selectVideoDevice(devices)` / `selectAudioDevice(devices)` without pre-passing the list: In the exported `selectDevices` function (lines 71–77) the scan is done once and both lists are passed down, which is correct. However, callers who call `selectVideoDevice()` and `selectAudioDevice()` independently (without arguments) will each trigger their own `scanDevices()` call — two ffmpeg spawns. A module-level scan cache or a note in the JSDoc warning against independent calls would prevent this.

## Consistency / Style Alignment
- [x] Import uses the `.ts` extension explicitly on line 2 (`import { logger } from "../logger.ts"`): Other modules in the codebase use extension-less or `.js` imports per TypeScript/Bun conventions. Align with the project import style. — SKIPPED: `stream-tts.ts` in the same directory uses `"../logger.ts"` with `.ts` extension; this is the established project convention.
- [x] `forEach` used on lines 51–53 and 63–65 where a `for...of` loop would be more consistent with the scanning loop on line 24 and is more idiomatic for side-effect-only iteration in this codebase.
- [x] No JSDoc comments on any exported function: the rest of the codebase uses JSDoc for public API documentation. Add at minimum a one-line description and note the macOS-only (`avfoundation`) constraint.

## Notes
- This module is macOS-only by design (hardcoded `-f avfoundation`). This is not documented anywhere in the source file itself — only in `src/utils/CLAUDE.md`. A runtime guard or a JSDoc `@platform` note would prevent silent failure on Linux/Windows.
- The module is used at startup by audio and vision systems. Any blocking `prompt()` call will pause the entire startup sequence; callers should be aware this is interactive and cannot be used in headless contexts. The `selectDevices` function has no non-interactive fallback.
- The asymmetry between `selectVideoDevice` (returns a bare ID like `"0"`) and `selectAudioDevice` (returns `:0`) is a potential integration hazard for callers combining both into a single ffmpeg device string such as `"0:0"`.
