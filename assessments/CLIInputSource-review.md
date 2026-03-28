# Assessment: CLIInputSource
**File:** src/agents/input-sources/CLIInputSource.ts
**Reviewed:** 2026-03-28
**Risk level:** Low

## Bug Fixes
- [x] Missing `this.running` guard in `start()`: The base class `InputSource` documents that subclasses must check `this.running` before registering listeners, and set `this.running = true` after starting. Without this guard, calling `start()` twice registers a second `data` listener on `process.stdin`, causing every line to emit `direct_input` twice. Fix: check `if (this.running) return;` at the top of `start()` and set `this.running = true` before returning.
- [x] Missing `this.running` update in `stop()`: `stop()` never sets `this.running = false`, so any caller inspecting lifecycle state sees a stale value. Fix: add `this.running = false;` in `stop()`.
- [x] `data.toString()` is redundant after `setEncoding`: Line 11 sets `process.stdin.setEncoding("utf-8")`, which makes Node/Bun deliver `string` chunks to `data` listeners. The `data.toString()` call on line 15 is therefore harmless today but subtly incorrect — it assumes `data` could still be a `Buffer`. Remove `.toString()` and type `data` as `string`.

## Refactoring / Code Quality
- [x] No `stop()` cleanup for the `data` listener: `stop()` only calls `process.stdin.pause()` but never removes the listener registered in `start()`. If the source is stopped and restarted, each start adds another listener. Fix: store the handler in a private field (e.g. `private _onData`) in `start()`, then call `process.stdin.off("data", this._onData)` in `stop()`.
- [x] `process.stdin` is a module-level global side effect: Using `process.stdin` directly couples the class tightly to a single global stream. Consider accepting an optional `stream: NodeJS.ReadableStream` constructor parameter defaulting to `process.stdin`. This also makes the class testable without monkey-patching globals.

## Security
No issues found.

## Performance
No issues found.

## Consistency / Style Alignment
- [x] `this.running` lifecycle not followed: `MicrophoneInputSource` (the sibling class) also does not set `this.running`, but `InputSource`'s JSDoc explicitly states subclasses must manage it. Both should comply; this module should set the pattern by fixing it here.
- [x] Logger namespace is a bare string literal: Line 21 passes `"CLI"` as the namespace. `MicrophoneInputSource` uses `"Microphone"`. Both are consistent with each other, but the class has a `name = "CLI"` field. Using `this.name` instead of a string literal keeps the two in sync automatically: `logger.info(this.name, "Input ready. Type to chat.")`.

## Notes
This module is intentionally minimal — it is a thin stdin adapter. The most impactful fix is the missing `this.running` guard and listener cleanup, which prevents listener accumulation on restart. The `data.toString()` call is a minor type correctness issue. No cross-module concerns beyond the `InputSource` base-class contract described above.
