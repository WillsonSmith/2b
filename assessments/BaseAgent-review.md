# Assessment: BaseAgent
**File:** src/core/BaseAgent.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] **Proactive timer not paused on `pause()`** (line 102–106): `pause()` clears `tickTimer` but never clears `proactiveTimer`. Proactive tasks continue firing while the agent is paused, queuing ambient input that will be processed the moment `resume()` is called. Fix: add `if (this.proactiveTimer) { clearInterval(this.proactiveTimer); this.proactiveTimer = null; }` in `pause()`, and restart it in `resume()`.
- [x] **No `stop()` method — resource leak**: `proactiveTimer` (a `setInterval`) and `tickTimer` are never cleared when the agent is done. Add a `stop()` method that clears both timers and optionally stops all input sources.
- [x] **Queue inputs silently dropped on `act()` throw**: In `tick()` (line 116–130), queues are drained before `act()` is called. If `act()` throws, those inputs are gone. The `finally` block does not restore them. Consider whether unrecoverable loss is intentional; if not, push the drained items back at the start of the `catch` block.
- [x] **`isThinking` not set before first `await` barrier in `tick()`**: `isThinking` is set inside `act()` as its first synchronous statement (line 139), which is safe under JS's single-threaded model. However, between draining queues and calling `act()`, a re-entrant `tick()` call (e.g. from `addDirect`) would pass the `isThinking` guard, drain the now-empty queues, and silently no-op — losing the re-entrant signal. Set `this.isThinking = true` in `tick()` immediately after draining queues (before the `if (direct.length > 0 || ambient.length > 0)` check) and remove it from `act()`.

## Refactoring / Code Quality
- [x] **`act()` is ~100 lines** (lines 138–248): Extract `_collectMessages()`, `_collectSystemPrompt()`, and `_collectTools()` helpers. This makes each concern independently testable and reduces cognitive load.
- [x] **`isThinking` ownership split across `tick()` and `act()`**: The flag is checked in `tick()` but set in `act()` and reset in `tick()`'s `finally`. Centralising the flag in `tick()` (see Bug Fix above) removes this split-ownership confusion.
- [x] **`_scheduleProactiveCheck` uses leading underscore** (line 85): All other private methods use plain camelCase. Rename to `scheduleProactiveCheck` or use consistent underscore style across the class.
- [x] **`proactiveTimer` typed as `ReturnType<typeof setTimeout>`** (line 19): The field holds the return of `setInterval`, not `setTimeout`. Rename the type annotation to `ReturnType<typeof setInterval>` to accurately reflect its content.
- [x] **Silent swallow of `onError` handler errors** (line 129): `try { plugin.onError?.(err); } catch {}` discards exceptions thrown by error handlers. At minimum log them: `catch (e) { logger.warn("BaseAgent", "onError handler threw", e); }`.

## Security
- [ ] **Tool args passed to plugins without validation** (`act()`, line 204–210): `args` from the LLM response are forwarded directly to `plugin.executeTool`. If a plugin executes shell commands or filesystem operations, a prompt-injection attack could craft malicious args. Consider adding a per-tool `validate(args)` hook to `ToolDefinition` so plugins can enforce schemas before execution. **SKIPPED** — requires modifying `Plugin.ts` (outside target module).

## Performance
- [x] **`buildSystemPrompt` called twice per tick** (lines 214 and 220): The method is called once to slice 400 chars for a debug log and again immediately after to get the real value. Cache the result: `const systemPrompt = this.buildSystemPrompt(...); logger.debug("BaseAgent", `...${systemPrompt.slice(0, 400)}…`);`.

## Consistency / Style Alignment
- [x] **`start()` logs after starting input sources** (lines 98–102): If any `source.start()` throws mid-loop, the log line is never reached and the error path is ambiguous. Move the log line before the loop, or wrap the loop in a try/catch with its own log.
- [x] **Mixed use of optional chaining and explicit null checks**: `this.currentAbortController?.abort()` (line 76) vs `if (this.tickTimer) clearTimeout(this.tickTimer)` (line 102). Pick one style for nullable fields and apply consistently.

## Notes
- The proactive timer bug (category: Bug Fixes) is the highest-priority item — it causes unexpected LLM calls after `pause()`.
- There is no `stop()` lifecycle method, which may surprise consumers who expect a symmetric counterpart to `start()`. Any wrapper (e.g. `CortexAgent`) that creates a `BaseAgent` and wants to tear it down cleanly currently has no supported path.
- `dispatchMessage` and `buildSystemPrompt` are private helpers with clean, focused responsibilities — no changes needed there.
