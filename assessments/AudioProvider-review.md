# Assessment: AudioProvider
**File:** src/providers/audio/AudioProvider.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] Unhandled `monitorStream` errors (line 60–66): `monitorStream()` is called as a fire-and-forget async method. Any error thrown inside the `for await` loop (e.g., ffmpeg crash, stream read failure) is silently swallowed. Add a `.catch()` call at the `start()` call site or wrap the loop body in `try/catch` and emit an `"error"` event so callers can react.
- [x] Race condition between `stop()` and `monitorStream()` (lines 52–66): `stop()` sets `this.process = null` immediately after `process.kill()`, but `monitorStream()` may still be iterating `this.process.stdout`. This can result in a brief period where the loop emits `"audio_chunk"` after the provider is considered stopped, or two concurrent monitor loops if `start()` is called again before the old loop drains. Use an `AbortController` or a boolean `stopped` flag checked inside the loop to break out cleanly.

## Refactoring / Code Quality
- [x] `private process: any = null` (line 6): Typing `process` as `any` loses all type safety. Replace with `ReturnType<typeof spawn> | null` to get proper types for `.kill()` and `.stdout`.
- [x] `start()` and `stop()` lack return type annotations (lines 19, 52): Add `: void` return types to be explicit and consistent with TypeScript conventions.
- [x] Fire-and-forget async call in `start()` (line 49): `this.monitorStream()` is called without `await` intentionally, but this is non-obvious. Add a comment explaining this is deliberate fire-and-forget, or assign the promise to a property so it can be awaited or cancelled later.

## Security
- [x] Space character allowed in `validateDeviceId` regex (line 14): The regex `^[a-zA-Z0-9 \-:._]+$` permits spaces in device IDs. While `spawn` passes arguments as an array (preventing shell injection), a space in a device ID could cause unexpected behavior if the ID is ever used in a different context (logging, error messages, future shell invocations). Document that this is intentional or tighten the regex if spaces are not expected in valid device IDs.

## Performance
- [ ] ~~`Buffer.from(chunk)` copies each audio chunk (line 63)~~: SKIPPED — `AudioSystem.ts` (line 16) consumes `audio_chunk` typed as `Buffer`. Changing the emit type to `Uint8Array` would break the downstream consumer without modifying files outside this module's scope.

## Consistency / Style Alignment
- [ ] ~~Logger import uses `.ts` file extension (line 3)~~: SKIPPED — all other source files in the project also use `.ts` extensions in logger imports (confirmed by codebase search). The import is already consistent with project-wide convention.

## Notes
- This module is macOS-specific (`avfoundation` input format). Any cross-platform usage will fail silently because ffmpeg is invoked with `-loglevel quiet` and stderr is ignored. If cross-platform support is ever needed, the ffmpeg input format (`-f avfoundation`) and device ID convention (`:0`) must be parameterized.
- The module depends on `ffmpeg` being available in `PATH` at runtime. There is no check for its presence before spawning. A missing `ffmpeg` binary will cause `spawn` to throw or produce a dead process, and without error handling in `monitorStream`, this will be invisible to the caller.
