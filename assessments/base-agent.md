# BaseAgent Assessment

**Files covered:**
- `src/core/BaseAgent.ts` (primary)
- `src/core/Plugin.ts`
- `src/core/InputSource.ts`
- `src/core/types.ts`
- `src/providers/llm/LLMProvider.ts`
- `src/core/CortexAgent.ts`
- `src/core/HeadlessAgent.ts`
- `src/agents/AgentFactory.ts`
- `src/plugins/SubAgentPlugin.ts` (importer of BaseAgent)
- `src/plugins/AudioPlugin.ts` (importer of BaseAgent)

---

## Interface contract

`BaseAgent` extends `EventEmitter` directly but makes no reference to the `AgentEventMap` type defined in `src/core/types.ts`. The typed event map exists but is never applied to `BaseAgent` itself — only `CortexAgent` surfaces it to callers through its own `on`/`once`/`off` overloads. As a result, anyone listening to events on a raw `BaseAgent` instance gets no type checking or autocomplete on event names and argument shapes.

`Plugin.ts` defines `ToolDefinition.parameters` as `any` and `ToolDefinition.implementation` as `(args: any) => any | Promise<any>`. Similarly, `AgentPlugin.executeTool` takes and returns `any`. These three `any` escape hatches cascade: an incorrect tool schema or return value is never caught by the type system, and the runtime sees untyped data flowing from the LLM through the plugin into user code.

`LLMProvider.chat` accepts `messages: Message[] | any[]` — the union with `any[]` fully disables the type constraint on the messages parameter at the call site in `act()`.

---

## Constructor / configuration

`BaseAgent` is constructed with an `LLMProvider` and an `AgentConfig`. The config type exposes these fields relevant to BaseAgent's behaviour:

- `systemPrompt` — required, no validation that it is non-empty
- `heartbeatInterval` — optional, defaults to `3000` ms inline at the `scheduleTick` call site (not in a named constant or in the config interface itself)
- `historyLimit` — optional, defaults to `20` inline at the `plugin.getMessages(this.config.historyLimit ?? 20)` call site
- `model` — stored on the config but BaseAgent never reads it; it is passed to the LLMProvider externally, so `model` on `AgentConfig` is dead from BaseAgent's perspective
- `embeddingModel` — same as `model`; BaseAgent does not use it
- `toolCallingStrategy` — same; BaseAgent passes it nowhere; the LMStudioProvider reads it from its own constructor options
- `cortexName` — used only by `CortexAgent` to name the memory plugin; dead in `BaseAgent`
- `name` — optional; the default `"Agent"` used by the `name` getter is undocumented

The defaults for `heartbeatInterval` and `historyLimit` are scattered at use sites rather than being centralised. A caller that never reads the source cannot discover these defaults without a search.

---

## Entry point: start() and the tick loop

`start()` runs `onInit` for every plugin synchronously (it does not await them — `onInit` returns `void`, so async plugins would silently fire-and-forget), then awaits each `InputSource.start()` in a `for…of` loop (serial, not parallel). After all sources are started, `scheduleTick` is called.

`scheduleTick` queues a `setTimeout` for `heartbeatInterval` ms. When that timer fires, `tick` runs. After every `tick` (including ticks that had nothing to do), `scheduleTick` is called again, creating a recurring interval effect through chained `setTimeout` calls. This is intentional (allows the interval to stretch when `act` is slow) but means if `act` throws and the finally block re-schedules, and then the catch block in `tick` also runs plugin error handlers, the next `scheduleTick` call at line 160 is still reached because it sits outside both the `if (direct.length > 0 || ambient.length > 0)` block and the try/catch.

If both queues are empty when `tick` fires, the heartbeat reschedules without doing work. This is fine, but means the agent burns a timer cycle every `heartbeatInterval` ms regardless of activity.

`tick` is `async` but is called without `await` from `addDirect`, the `setTimeout` callback, and `resume`. If `tick` throws outside the internal try/catch (which it can only do before the try block, i.e., in the queue-draining steps) the error becomes an unhandled promise rejection.

---

## act() — the main per-turn pipeline

`act` runs the following stages in order:

1. Set `isThinking = true` and create a new `AbortController`.
2. Collect conversation history from all plugins that implement `getMessages`. Messages from multiple plugins are concatenated without deduplication or ordering guarantees between plugins.
3. Append the current direct + ambient inputs as a single `user` message — joined with `\n`. Direct and ambient inputs are mixed into one string with no structural separator; the LLM cannot distinguish which parts were direct and which were ambient.
4. Collect `getSystemPromptFragment` and `getContext` results. `getContext` is called in the same loop iteration but the logger shows a `debug` line for system prompt fragments before context, yet the code gathers them in the same loop. This is a minor ordering confusion in the source.
5. Wire tools: for each plugin with `getTools`, if a tool lacks `implementation` and the plugin has `executeTool`, a closure is assigned. This mutates the `ToolDefinition` objects returned by `plugin.getTools()`. If `getTools` returns the same object references across calls (a common pattern), the implementation is patched in-place on the first tick and reused on subsequent ticks. On the first tick for a plugin that returns fresh objects each call, the patch is done fresh. There is no audit trail of which plugin provided which tool; name collisions between plugins are silently resolved by last-write-wins (the later plugin's tool overwrites the earlier's in the `tools` array, but because they are pushed separately the array actually holds both — the LLM can call either, but if two tools share a name the provider may use only the first or last).
6. Build `systemPrompt` by calling `buildSystemPrompt` **twice** — once for the debug log and once for the actual call. The second invocation regenerates an identical value, but if any side-effecting plugin fragment or context were involved, it would be called twice. Currently fragments and context are already gathered before this point so the second call is safe, but the duplication is wasteful and fragile if the construction logic changes.
7. Call `dispatchMessage("user", ...)` to notify plugins of the user message. This happens **after** the system prompt is built and tools are collected but **before** the LLM call. This means any plugin that modifies its own state in `onMessage` (e.g. appending to history) will see the new message before the LLM sees it, but the history collected in step 2 was gathered before this dispatch, so the just-dispatched user message will not appear in `messages` for this call — it only appears as the synthetic last entry added in step 3. This is consistent behaviour but means history-providing plugins see an asymmetry: they supply up-to-N prior messages in `getMessages`, then `act` appends the current user message separately. If a plugin's `getMessages` already includes the current turn, the message would appear twice.
8. Call `llm.chat`. The `AbortController` is created and stored but its signal is **never passed to `llm.chat`**. The `interrupt()` method aborts the controller, but there is no mechanism to actually cancel the HTTP request or streaming operation at the LLM layer. The abort is purely cosmetic at the transport level.
9. Emit `"thought"` unconditionally even when `reasoningText` is `undefined` or empty (the emit is `this.emit("thought", reasoningText)` with no guard).
10. Check the `IGNORE_KEYWORD` only in `nonReasoningContent`. If the reasoning text contains `[IGNORE]` but the response does not, the agent correctly responds. If the response is exactly `[IGNORE]` with extra whitespace or casing, the `includes` check would still catch it, but a model that returns `[ignore]` (lowercase) would not be caught.
11. Run `augmentResponse` on each plugin in sequence, passing the previous result to the next. If plugin A transforms the response and plugin B crashes, the error is caught, but `finalResponse` remains as A's output. The chain silently drops B's transformation. The final response may be a partial chain result with no indication of the failure beyond a log line.
12. Call `dispatchMessage("assistant", finalResponse, "direct")`. Note the source is hardcoded to `"direct"` regardless of whether the trigger was ambient. This may mislead plugins (such as history plugins) that use `source` to determine storage behaviour.
13. Emit `"speak"`.

`isThinking` is set to `true` at the start of `act` but `act` itself does not reset it — the reset lives in the `finally` block of `tick`. If `act` is ever called directly (it is private, so not from outside, but subclasses could be affected), the flag would not be cleared. More critically, if `tick` is exited before the finally block runs (which should not happen with a finally clause, but is worth noting), the agent would deadlock with `isThinking = true`.

---

## buildSystemPrompt()

`buildSystemPrompt` builds its parts array starting with `this.config.systemPrompt`. If `systemPrompt` is an empty string, `filter(Boolean)` removes it, which silently drops the base prompt. No validation prevents this.

The ordering is: base prompt → must/must-not-respond instruction → plugin context → plugin fragments. This means static plugin instructions (fragments) appear after dynamic plugin context. In most LLMs, instructions are best placed before context. Reversing the order of context and fragments could improve model adherence.

The must-respond instruction says "You MUST provide a response." The must-not-respond instruction says to reply with exactly the `IGNORE_KEYWORD`. These two instructions are mutually exclusive and context-dependent, which is correct. However, if a future code path calls `buildSystemPrompt` with `mustRespond = false` while direct inputs are present, the model would be told it can ignore the input when it actually cannot.

The `IGNORE_KEYWORD` value `"[IGNORE]"` is a private field but is also embedded in the system prompt string at runtime. If the constant is changed, the check at line 251 (`cleanResponse.includes(this.IGNORE_KEYWORD)`) updates automatically, but any cached or logged prompts would become stale.

---

## dispatchMessage()

`dispatchMessage` iterates plugins and calls `plugin.onMessage` in registration order. Each call is individually try-caught. This means a crashing plugin does not abort the chain, but the error is only logged — it is not re-emitted as an agent-level error event. Callers of `dispatchMessage` have no way to know that one or more plugins failed.

The `source` parameter is typed as `string` (open) in `AgentPlugin.onMessage`, but `dispatchMessage` is always called with either `"input"` or `"direct"`. There is no enum or union constraining this, so plugins must handle an arbitrary string. The `"input"` / `"direct"` distinction is not documented anywhere in the plugin interface.

`dispatchMessage` is `await`-ed, meaning the pipeline waits for all `onMessage` handlers to complete before proceeding. A slow plugin (e.g., one writing to disk) blocks the LLM call for user messages and blocks the `"speak"` emit for assistant messages.

---

## Proactive task scheduler

`scheduleProactiveTick` pushes a new task entry with `lastRun: 0`. On the first check, `now - 0 >= intervalMs` is true for any `intervalMs <= now` (i.e., always, since epoch is January 1970). This means every registered proactive task fires immediately on the first proactive check rather than waiting one full interval. This may be intentional (eager first run) but is not documented.

`_scheduleProactiveCheck` uses `setInterval` and the guard `if (this.proactiveTimer) return`. This means the interval is set to `Math.min` of all registered task intervals at the time the first task is registered. If a second task is registered later with a shorter interval, the existing timer is not updated — the new task will still be checked at the original (longer) interval, potentially delaying its first true-interval fire.

The `proactiveTimer` is never cleared. There is no `stop()` or `destroy()` method on `BaseAgent`. The `pause()` method stops `tickTimer` but not `proactiveTimer`, so proactive tasks continue to queue ambient input even while the agent is paused. This can cause input to accumulate in `ambientQueue` during a pause and flood the agent's first tick after `resume()`.

There is no error isolation around `entry.task()`. If a proactive task function throws synchronously, it propagates out of the `setInterval` callback and becomes an unhandled exception. The try/catch inside the `tick` method does not cover this path.

---

## Interrupt / abort

`interrupt()` calls `this.currentAbortController?.abort()` and emits `"interrupt"`. As noted in the `act()` section, the `AbortController` signal is created and stored but never wired to the LLM provider's `chat` call. The abort has no actual effect on the in-flight HTTP request. The LLM will continue streaming until completion; the agent will then process the full response even though the interrupt was requested.

A new `AbortController` is created at the start of every `act()` call. If `interrupt()` is called between ticks (when `currentAbortController` is `null`), there is no effect. If called mid-turn, the controller is aborted but — due to the missing wire-up — the LLM still completes. The `isThinking` flag is not reset by `interrupt()`, so the agent remains locked in the thinking state until `act()` naturally finishes.

There is no mechanism to drain or discard queued input after an interrupt. After barge-in (as used by `AudioPlugin`), the interrupted turn completes, its response is emitted via `"speak"`, and then the new direct input is processed. The old response could reach text-to-speech before the new turn begins, depending on consumer timing.

---

## Plugin integration

Tool wiring in `act()` mutates `ToolDefinition` objects in place (line 219: `t.implementation = ...`). If `getTools()` returns cached/shared objects, the implementation is stamped once and reused. If it returns fresh objects each call, the closure is recreated every tick. Neither behaviour is specified by the `AgentPlugin` interface contract, so plugin authors cannot rely on either.

The `tool_call` event is emitted inside the implementation closure before delegating to `plugin.executeTool`. This means the event fires even if `executeTool` ultimately returns `undefined` (unknown tool name, per convention). The event name and args are captured as closure variables from the time of wiring, not the time of invocation, which is correct for the name but means arg types are fixed at `any`.

There is no registry or deduplication of tool names across plugins. If two plugins expose a tool with the same name, both definitions appear in the `tools` array passed to `llm.chat`. The LLM provider receives both and may call either; the `tool_call` event fires with the name, but which plugin handles it depends on `executeTool` returning non-undefined. The first plugin in registration order to return a non-undefined result wins, since there is no routing loop — the LLM provider itself selects and invokes the implementation closure that was stored on the specific `ToolDefinition` object it received. The two closures point to their respective plugins, so the LLM implicitly picks one based on which definition it selected — but if it selected the first-registered plugin's definition for a second-registered plugin's tool, there would be a mismatch.

Plugin `onInit` receives the `BaseAgent` instance, giving plugins a reference to call `addDirect`, `addAmbient`, `addPerception`, `interrupt`, and `emit` directly. This is intentional (AudioPlugin uses it), but it also means a plugin can call `emit("speak", ...)` or enqueue input in unexpected ways, bypassing the normal pipeline.

---

## Error handling and visibility

`tick` has a top-level try/catch around `act()`. Errors from `act` are:
1. Re-emitted as `"error"` on the agent.
2. Dispatched to each plugin's `onError` (individually try-caught).
3. Swallowed after that — no rethrow.

If no listener is attached to `"error"` on the `EventEmitter`, Node.js/Bun will throw an uncaught exception. This is standard `EventEmitter` behaviour but is not documented.

Errors inside `dispatchMessage` (plugin `onMessage` failures) are logged but not emitted as `"error"` events and not passed to plugin `onError` handlers. They are fully silent at the agent API level.

Errors inside `augmentResponse` are logged but do not abort the augmentation chain (the failed plugin's transformation is skipped). The caller receives a partially augmented response with no indication of the failure.

Proactive task exceptions (from `entry.task()`) are not caught and surface as unhandled exceptions in the `setInterval` callback.

The error in `act`'s plugin history collection (`getMessages` failures) is logged and the plugin's messages are skipped. The agent continues with a potentially shorter-than-expected history — this silent partial failure could affect response quality without any observable signal to the operator.

---

## Deployment / integration context

In `AgentFactory.ts`, a single `LMStudioProvider` instance (`llm`) is shared between the orchestrator (`CortexAgent`) and all four sub-agent factories (`createMediaAgent`, `createWebAgent`, `createSystemAgent`, `createInfoAgent`). Each sub-agent's `HeadlessAgent` receives the same provider reference. The provider is not shown to be thread-safe or request-safe for concurrent calls. If the orchestrator and a sub-agent (via a tool call triggered by the orchestrator's LLM turn) both call `llm.chat` concurrently, any shared mutable state in `LMStudioProvider` (e.g., a request counter, a streaming buffer) could be corrupted. This needs verification against `LMStudioProvider`'s implementation.

`CortexAgent` does not extend `BaseAgent` — it wraps it. The wrapper exposes a manually mirrored subset of `BaseAgent`'s public API (`registerPlugin`, `addInputSource`, `start`, `addDirect`, `addAmbient`, `interrupt`, `setTokenCallback`, `scheduleProactiveTick`, `pause`, `resume`, `on`, `once`, `off`, `name`). Methods added to `BaseAgent` in the future must be manually added to `CortexAgent` to remain accessible, and there is no compile-time enforcement of this. The `AgentEventMap`-typed `on`/`once`/`off` overloads on `CortexAgent` use `TEvents[K] & any[]` — the `& any[]` intersection undermines the type safety they are meant to provide.

`AgentFactory` registers plugins in this order: `SubAgentPlugin × 4`, `MinimalToolsPlugin`, `MemoryPlugin`. `MemoryPlugin`'s `getMessages` is therefore called last. Since history from multiple plugins is concatenated, the ordering of messages in the context window depends on plugin registration order. No documentation specifies the expected ordering.

The `pause()` / `resume()` public API is not proxied through `CortexAgent` — it is, actually, present (lines 67–68 of `CortexAgent.ts`). However, `scheduleProactiveTick` is also proxied. But there is no `stop()` / `destroy()` on either class. Long-running deployments accumulate `setInterval` timers (one per `scheduleProactiveTick` call) with no way to clear them.

InputSource `stop()` is defined as abstract on the base class but `BaseAgent.start()` calls `source.start()` for each source. There is no `BaseAgent` method that calls `source.stop()`. If the agent is disposed, InputSources are never stopped and their event listeners remain attached to the agent.

---

## Summary Table

| Area | Severity | Issue |
|---|---|---|
| Interface contract | Medium | `BaseAgent` does not apply `AgentEventMap` to itself; event listeners on raw `BaseAgent` get no type safety |
| Interface contract | Medium | `ToolDefinition.parameters`, `ToolDefinition.implementation`, and `AgentPlugin.executeTool` all use `any`, propagating untyped tool data through the entire pipeline |
| Interface contract | Low | `LLMProvider.chat` accepts `Message[] \| any[]`, bypassing message type enforcement at the call site |
| Constructor / config | Low | `heartbeatInterval` and `historyLimit` defaults are scattered at use sites, not documented or centralised |
| Constructor / config | Low | `model`, `embeddingModel`, `toolCallingStrategy`, and `cortexName` fields on `AgentConfig` are dead from `BaseAgent`'s perspective; only used by `CortexAgent` or the LLM provider constructor |
| Entry point: start() | Low | `onInit` is synchronous-only; async `onInit` implementations would silently fire-and-forget |
| Entry point: start() | Low | `InputSource.start()` calls are serial; many sources could be started in parallel |
| tick loop | Medium | `tick` is called without `await` from `addDirect` and `scheduleTick` callbacks; exceptions before the internal try block produce unhandled promise rejections |
| tick loop | Low | Heartbeat reschedules even when both queues are empty, burning a timer slot per interval with no work |
| act(): message assembly | Medium | Direct and ambient inputs are merged into a single `\n`-joined user message string; the model cannot distinguish input classes |
| act(): history | Medium | History is collected before `dispatchMessage("user", ...)` is called, so a plugin that appends the current user message in `onMessage` would cause a double-entry on the next turn if its `getMessages` returns the just-stored message |
| act(): system prompt | Low | `buildSystemPrompt` is called twice per turn (once for debug logging, once for use), wasting work and creating a fragile pattern |
| act(): system prompt | Low | Plugin context appears before plugin fragments in the system prompt; instruction ordering (fragments first) would be more conventional |
| act(): abort | High | `AbortController` is created and stored but its signal is never passed to `llm.chat`; `interrupt()` has no actual effect on the in-flight LLM request |
| act(): abort | Medium | `interrupt()` does not reset `isThinking`; the agent remains locked in thinking state until `act()` finishes despite the interrupt |
| act(): abort | Medium | After barge-in, the interrupted turn's response is fully emitted via `"speak"` before the new turn begins; the old response may reach consumers |
| act(): tool wiring | Medium | Tool name collisions across plugins are not detected; both definitions are passed to the LLM and the outcome depends on which the model selects |
| act(): tool wiring | Low | `ToolDefinition` objects are mutated in place; plugins that return shared/cached tool objects see side effects across ticks |
| act(): ignore check | Low | `IGNORE_KEYWORD` check uses `includes`, so a response that contains `[IGNORE]` as a substring (not the entire response) would also be suppressed |
| act(): ignore check | Low | Case sensitivity: a model returning `[ignore]` or `[Ignore]` bypasses the check |
| act(): augmentResponse | Low | A crashing plugin in the `augmentResponse` chain silently skips that plugin's transformation; the final response is a partial chain with no error signal to callers |
| act(): dispatchMessage source | Low | `dispatchMessage` hardcodes `"direct"` as the source for assistant messages regardless of whether the trigger was ambient; misleads history plugins |
| buildSystemPrompt() | Low | An empty `systemPrompt` string is silently dropped by `filter(Boolean)`, removing the base prompt with no warning |
| dispatchMessage() | Medium | Plugin `onMessage` failures are logged but not emitted as `"error"` events and not passed to `onError`; they are invisible to callers |
| dispatchMessage() | Low | A slow plugin `onMessage` handler blocks the entire pipeline (LLM call for user messages, `"speak"` emit for assistant messages) |
| dispatchMessage() | Low | The `source` values `"input"` / `"direct"` are not documented or constrained in the plugin interface |
| Proactive scheduler | High | `entry.task()` is not wrapped in try/catch; a throwing proactive task produces an unhandled exception in the `setInterval` callback |
| Proactive scheduler | Medium | Every proactive task fires immediately on first check (`lastRun: 0`) rather than waiting one full interval; undocumented behaviour |
| Proactive scheduler | Medium | Proactive timer interval is fixed at registration time of the first task; later tasks with shorter intervals are not checked at the correct frequency |
| Proactive scheduler | Medium | Proactive timer is not stopped by `pause()`; tasks continue queuing ambient input while the agent is paused, causing a burst on resume |
| Proactive scheduler | Medium | `proactiveTimer` is never cleared; no `stop()` / `destroy()` method exists on `BaseAgent` or `CortexAgent` |
| Resource lifecycle | High | `InputSource.stop()` is never called; sources and their event listeners leak on agent disposal |
| Resource lifecycle | Medium | No `stop()` / `destroy()` on `BaseAgent` or `CortexAgent`; long-running processes accumulate timers with no clean shutdown path |
| Plugin integration | Medium | Plugin `onInit` receives a `BaseAgent` reference granting direct access to `emit`, `addDirect`, `addAmbient`, and `interrupt`; a misbehaving plugin can corrupt agent state |
| Error handling | Medium | `EventEmitter` `"error"` event with no listener causes an uncaught exception; not documented or guarded |
| Error handling | Low | `getMessages` failures silently shorten the context window; no operator-visible signal |
| Deployment / integration | High | Single `LMStudioProvider` instance shared across orchestrator and all sub-agents; concurrent `llm.chat` calls (orchestrator + in-flight tool calls) may race on shared provider state |
| Deployment / integration | Medium | `CortexAgent` manually mirrors `BaseAgent`'s public API; new `BaseAgent` methods are not automatically available via `CortexAgent` |
| Deployment / integration | Medium | `CortexAgent`'s `on`/`once`/`off` type overloads use `TEvents[K] & any[]`, undermining their type safety |
| Deployment / integration | Low | Plugin registration order in `AgentFactory` implicitly determines context window message ordering; undocumented dependency |
