# Assessment: CortexAgent
**File:** src/core/CortexAgent.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] Missing `stop()` delegation (line 9–88): `CortexAgent` exposes `start()`, `pause()`, and `resume()` but has no `stop()` method. `BaseAgent.stop()` cleans up timers and stops input sources — callers holding a `CortexAgent` reference have no way to trigger this cleanup, causing timer and resource leaks. Add a `public async stop(): Promise<void>` that delegates to `this.inner.stop()`.
- [x] `on()`/`once()`/`off()` return type mismatch (lines 70–83): The three event-forwarding methods return `this` (typed as `CortexAgent<TEvents>`), but the underlying `BaseAgent.on/once/off` return a `BaseAgent` instance. The return value from `this.inner.on(event, listener)` is discarded and `this` is returned instead, which is the correct fluent behaviour — but if `BaseAgent` ever extends the return contract (e.g., a subscription token), the wrapper silently drops it. This is a minor correctness concern but worth a comment documenting the intentional discard.
- [ ] `TEvents` generic is declared but never passed to `BaseAgent` (line 9): `CortexAgent<TEvents>` accepts a custom event map, and the `on`/`once`/`off` overloads use it for type checking, but `BaseAgent` is not generic and the inner emitter is untyped. Any event key outside `AgentEventMap` will pass TypeScript checks on `CortexAgent` but silently be ignored at runtime if `BaseAgent` does not emit it. This is a correctness gap for subclasses extending the event map. **[SKIPPED — fixing this requires making BaseAgent generic, which is a larger refactor outside the scope of this module's assessment.]**

## Refactoring / Code Quality
- [ ] Delegation boilerplate without interface (lines 33–87): `CortexAgent` manually re-declares every public method of `BaseAgent` as a thin one-liner delegate. There is no shared interface or abstract base that both implement, so any new method added to `BaseAgent` must also be manually added here. Consider extracting an `IAgent` interface from `BaseAgent`'s public surface and having `CortexAgent` implement it — this makes omissions a compile error rather than a silent gap (e.g., the missing `stop()` above). **[SKIPPED — extracting IAgent touches BaseAgent, HeadlessAgent, and potentially other consumers; out of scope for this module.]**
- [x] `cortexName` fallback chain is subtle and undocumented (line 25): `config.cortexName ?? config.name ?? "cortex"` silently picks a name. If neither field is set the memory namespace defaults to `"cortex"`, which would collide across multiple unnamed `CortexAgent` instances. A comment or a guard log would surface this at startup.
- [x] `synthesisProvider` parameter defaults to `null` not `undefined` (line 13): The parameter default is `null` but the rest of the codebase uses `undefined` for optional dependencies (e.g., `AgentConfig` optional fields use `?:`). Using `null` here creates a mixed nullability convention. Change the default and type to `synthesisProvider?: LLMProvider` to align with the project's style.
- [ ] `public readonly memoryPlugin` exposure (line 11): Exposing the concrete `CortexMemoryPlugin` as a public field breaks the encapsulation that the delegate pattern is otherwise trying to achieve. If callers manipulate `memoryPlugin` directly they bypass the agent's lifecycle. Consider whether a narrower accessor (e.g., a read-only property returning a more limited interface) is sufficient. **[SKIPPED — narrowing the type requires an interface not yet defined for CortexMemoryPlugin; conservative omission.]**

## Security
No issues found.

## Performance
- [x] System prompt is reconstructed on every `CortexAgent` construction (lines 14–21): This is trivially cheap and not a runtime hotpath, but the assembled `cortexSystemPrompt` is a one-time value that could be a named constant or computed lazily. No action required unless the prompt grows significantly; flagged for awareness only.

## Consistency / Style Alignment
- [x] Inline single-liners on the same line as the method signature (lines 67–68): `public pause(): void { this.inner.pause(); }` and `public resume(): void { this.inner.resume(); }` are formatted as one-liners, while all other methods in the file use multi-line bodies. This is a minor inconsistency with the file's own style.
- [x] `addAmbient` opts parameter type is inlined (line 51): `opts?: { forceTick?: boolean }` is repeated inline. `BaseAgent.addAmbient` uses the same inline type. If `BaseAgent` ever adds more options, the signature in `CortexAgent` will silently fall out of sync. Extracting a shared `AmbientOptions` type in `types.ts` would keep both in sync and is consistent with how `AgentConfig` and `AgentEventMap` are centralised.
- [x] No JSDoc on public API (lines 33–87): `BaseAgent`'s public methods have JSDoc comments. The equivalent methods on `CortexAgent` have none, which makes the wrapper's intent (and any deliberate behavioural differences) invisible to consumers relying on IDE hints.

## Notes
- `CortexAgent` is a pure composition wrapper around `BaseAgent` — it adds `CortexMemoryPlugin` and `ThoughtPlugin` but otherwise provides no distinct behaviour. Any future capability changes to `BaseAgent`'s public surface require a corresponding change here; this coupling should be tracked.
- `ThoughtPlugin` is constructed inside the constructor and its reference is not retained on the class. If callers ever need to inspect or configure thought synthesis after construction, the `CortexAgent` API will need to expose it similarly to `memoryPlugin`.
- Reviewers of `BaseAgent` should note that `CortexAgent` does not forward `addPerception()` — this is an intentional omission whose rationale is not documented.
