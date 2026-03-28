# Assessment: VoiceActivityDetector
**File:** src/providers/audio/VoiceActivityDetector.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] Division by zero in `calculateEnergy` (line 86): If `chunk` is an empty `Buffer` (`buffer.length === 0`), `sampleCount` is `0` and `Math.sqrt(sumSquares / sampleCount)` returns `NaN`. `NaN > this.threshold` is `false`, so the chunk is silently treated as silence — add an early return of `0` when `buffer.length === 0`.
- [x] Odd-length buffer in `calculateEnergy` (line 86): If `buffer.length` is odd, `sampleCount` becomes a non-integer (e.g. `1.5`) and the last byte is silently skipped, producing a subtly wrong energy value. Add a guard: `if (buffer.length % 2 !== 0) throw new Error("Buffer length must be even for s16le audio")` or clamp to `Math.floor`.
- [x] No null/undefined guard on `processChunk` (line 27): Passing `null` or `undefined` as `chunk` causes `calculateEnergy` to throw on `buffer.length`. Add a type guard or runtime check at the top of `processChunk`.
- [x] Redundant `this.silenceTimer = null` in `completeUtterance` (line 69): `completeUtterance` is only ever called from inside the `setTimeout` callback, meaning the timer has already fired. Setting the reference to `null` here is harmless but misleading — add a comment clarifying this is defensive cleanup, or restructure so the null-out happens in the callback closure before calling `completeUtterance`.

## Refactoring / Code Quality
- [x] No `reset()` / `destroy()` method: There is no way for a caller to cancel an in-progress utterance, clear `audioBuffer`, or cancel `silenceTimer` when the input stream ends prematurely. Add a public `reset()` method that clears the timer and buffer and resets `isRecording`.
- [x] Missing `speech_ended` event: `speech_started` is emitted when recording begins but there is no corresponding event when silence is first detected (before the timer fires). Adding a `speech_ended` event would give consumers symmetry and allow UI feedback like "processing…" spinners.
- [x] Commented-out debug `console.log` lines (lines 47, 75): These dead comments add noise. Replace with a boolean `debug` flag on `VADConfig` that gates a proper log call, or remove them entirely.
- [x] `Timer` type (line 11) is a Bun global: It is used without an import or declaration comment. Add a brief comment (`// Bun global`) or use `ReturnType<typeof setTimeout>` for broader compatibility.

## Security
No issues found.

## Performance
- [x] Unbounded `audioBuffer` growth (line 10 / line 57): During a long or continuous utterance, `audioBuffer` accumulates every chunk with no size cap. A pathological audio source could exhaust memory before `completeUtterance` fires. Consider enforcing a maximum buffer size (e.g. 60 seconds of audio) and emitting the utterance early if the cap is reached.
- [x] `Buffer.concat` length scan overhead (line 72): `Buffer.concat` internally scans all chunk lengths to compute total size before allocating. For utterances with many small chunks, tracking a running `totalBytes` counter during `push` calls and using `Buffer.allocUnsafe(totalBytes)` with a manual copy loop would avoid this redundant scan. This is a minor optimisation but worth noting for high-throughput use.

## Consistency / Style Alignment
- [x] `node:events` import (line 1): CLAUDE.md mandates Bun-first conventions. While `node:events` works under Bun, verify that other EventEmitter-based modules in this codebase use the same import to keep it consistent. — Verified: all EventEmitter modules in the project use `node:events`; no change needed.
- [x] Event name casing (`speech_started`, `utterance_complete`): These use `snake_case`. Verify this matches the event naming convention used by other EventEmitter modules in the project; if those use `camelCase`, align accordingly. — Verified: `AudioSystem` consumes these events with the same `snake_case` names; no change needed.

## Notes
- This module has no external dependencies beyond the Node/Bun built-in `EventEmitter` — it is self-contained and easy to unit test.
- Callers feeding audio from `MicrophoneInputSource` should ensure chunks are always even-length s16le buffers before calling `processChunk`; the contract is documented in the JSDoc but not enforced.
- The `silenceDuration` default of 1500 ms is a tuning parameter; downstream consumers (e.g. `AudioSystem`) should expose this in their own config rather than relying on the VAD default silently.
