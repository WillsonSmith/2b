# Assessment: InputSource
**File:** src/core/InputSource.ts
**Reviewed:** 2026-03-28
**Risk level:** Low

## Bug Fixes
- No issues found.

## Refactoring / Code Quality
- [x] No `isRunning` guard on the abstract contract: The interface allows callers to call `stop()` before `start()` or to call `start()` twice without error. Concrete implementations (e.g. `MicrophoneInputSource.stop()` calls `this.audioSystem?.stop()` where `audioSystem` may be undefined) work around this with optional chaining rather than a principled lifecycle guard. Consider adding a protected `running: boolean` state field to `InputSource` with `start()`/`stop()` guards so subclasses can rely on it, reducing defensive coding in every implementation.
- [x] Event names are undocumented in the type system: `"direct_input"` and `"ambient_input"` are described only in JSDoc. TypeScript's `EventEmitter` from `node:events` supports typed overloads via declaration merging or a generic wrapper. Adding typed `on`/`emit` overloads to `InputSource` (e.g. `on(event: "direct_input", listener: (text: string) => void): this`) would catch mismatched event names at compile time across all subclasses and callers.

## Security
- No issues found.

## Performance
- No issues found.

## Consistency / Style Alignment
- [ ] (skipped) Uses `node:events` import while the project targets Bun: Per CLAUDE.md, the project defaults to Bun. `EventEmitter` from `node:events` works under Bun, but Bun also exposes `EventEmitter` natively. The import is functionally correct but slightly inconsistent with the project's Bun-first stance. Low priority — worth aligning if other core files adopt Bun-native equivalents.

## Notes
- This is a minimal, well-scoped abstract base class. Its main cross-module concern is that `BaseAgent.addInputSource()` (line 40–41 of `BaseAgent.ts`) listens for exactly the two event names `"direct_input"` and `"ambient_input"` defined in the JSDoc here. Any rename or addition of event names in a subclass that is not reflected here will be silently ignored by `BaseAgent`. The typed overload suggestion above would close this gap structurally.
- `CLIInputSource` never removes its `"data"` listener on `stop()` — it only calls `process.stdin.pause()`. This is a separate module concern but stems from the lack of a cleanup contract on `InputSource`.
