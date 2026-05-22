# BaseAgent + CortexAgent — Framework Audit

**Scope:** `packages/framework/src/core/BaseAgent.ts` (758 lines) and `packages/framework/src/core/CortexAgent.ts` (197 lines), viewed against the full set of framework consumers.

**Consumers surveyed:**
- `packages/app-2b/2b.ts` — chat orchestrator with DynamicAgentPlugin, SubAgentPlugin, RetryPlugin, MemoryPlugin, 9 capability plugins
- `packages/app-episteme/src/agent.ts` — markdown editor agent with 15 plugins, 4 mode-gated via a proxy wrapper, plus an external `PlanningController`
- `packages/framework/src/core/CortexSubAgent.ts` — wraps `CortexAgent` for use as a Promise-based sub-agent inside `DynamicAgentPlugin`
- Indirect contract consumers via plugin APIs: `RetryPlugin` (`dispatchTool`), `MemoryPlugin` (`getLastSystemPrompt`, `requestMemoryWrite`), `MetacognitionPlugin` (`getAvailableTools`, `getRegisteredPlugins`, `getLastSystemPrompt`), `BehaviorPlugin` and `DynamicAgentPlugin` (`agent.memoryPlugin`)

**Severity legend:**
- 🔴 **Bug** — incorrect behavior that produces wrong results
- 🟠 **Footgun** — works today but invariants are implicit; future code will violate them
- 🟡 **Limit** — capability gap that a future agent will hit

---

## 1. Architectural map

### Tick lifecycle (BaseAgent)
```
addDirect ─► directQueue ─► tick() ─► act()
                                       │
                            collectMessages (plugins.getMessages, parallel)
                            collectSystemPrompt (plugins.getSystemPromptFragment + getContext, parallel)
                            collectTools (cached, plugins.getTools)
                            dispatchMessage("user", ...)         ← BEFORE LLM call
                            llm.chat(...)
                            └─ OllamaProvider.actWithTools (up to 100 rounds)
                               └─ tool.implementation() ← BaseAgent's wrapped closure
                                  └─ permission → veto → retry → executeTool → verifyAfter
                            augmentResponse (plugins, sequential)
                            dispatchMessage("assistant", ...)
                            emit("speak")
                            emit("tick_metrics")
```

### Critical boundary: the tool loop lives in the LLM provider
`OllamaProvider.actWithTools` runs up to 100 rounds internally. Each round it calls tool implementations directly — the closures returned by `BaseAgent.buildTools()` — and accumulates a *local* `history` array of assistant + tool messages. **None of that intermediate history is visible to BaseAgent or to plugins.** What plugins see via `onMessage` is one user message in, one final assistant message out.

This boundary is the source of several findings below — anywhere a plugin needs to observe, modify, or persist what happens *between* user input and final response, the framework currently offers no hook.

### CortexAgent
A façade, not a subclass. Construction is hardcoded:
- Augments `systemPrompt` with three cortex directives (`CortexAgent.ts:49-56`).
- Always registers four plugins in fixed order: `CortexMemoryPlugin`, `ThoughtPlugin`, `MetacognitionPlugin`, `YieldPlugin` (`CortexAgent.ts:69-72`).
- Exposes `memoryPlugin` as a public field for `DynamicAgentPlugin.parentMemory`.
- Proxies the BaseAgent API verbatim with no opt-out.

---

## 2. Findings

### Area A — Tick lifecycle & error semantics

#### F-1 🔴 `dispatchMessage("user", …)` fires *before* the LLM call, but the error path restores queues without rolling back side effects
**Citation:** `BaseAgent.ts:316-319, 619`

`act()` calls `dispatchMessage("user", userContent, "input")` immediately before the LLM call. The catch in `tick()` (lines 316-319) unshifts the queues, but **does not** undo the `onMessage` calls already made. Plugins that record on `onMessage("user", …)` — `MemoryPlugin.onMessage` (`MemoryPlugin.ts:62-77`), Episteme's `workspaceDb.appendChatMessage("user", …)` invoked via the server handler — will see the same user message twice when the tick re-runs.

**Impact across consumers:**
- `MemoryPlugin` pushes duplicate user entries into `this.messages`. After enough retries it triggers spurious summarization.
- Episteme already records user messages outside `onMessage` (in the WebSocket handler), but any plugin that hooks `onMessage("user")` will duplicate.
- `BehaviorPlugin` and others reading the message stream see false repetition signals.

**Repair options:**
1. Move `dispatchMessage("user", …)` to *after* the LLM call succeeds (preferred — symmetrical with assistant dispatch).
2. Add a `rollbackUserDispatch()` to plugins and call it in the catch (heavier, requires plugin coordination).

---

#### F-2 🔴 `emitTickMetrics` is skipped on the error path
**Citation:** `BaseAgent.ts:301-334, 675-690`

Tick metrics are emitted only at the *end* of a successful `act()`. The catch block in `tick()` emits `"error"` and returns without calling `emitTickMetrics`. `TickMetricsAggregator` and Episteme's `/api/metrics` therefore never see error ticks — average latency and tool counts skew positive, and there's no visibility into how often turns fail.

**Repair option:** Emit a `tick_metrics` with `errored: true` in the catch. Requires adding `errored` to `TickMetrics`.

---

#### F-3 🟠 `tick()`'s "drain then act" gives the in-flight `act()` no way to learn that new input arrived
**Citation:** `BaseAgent.ts:301-334`

When `act()` starts, `direct` and `ambient` arrays are captured by closure. A new `addDirect` during act() (which is common — a user mashing send, or an external event firing) re-enters `tick()`, hits `if (this.isThinking) return;`, and waits for the next heartbeat (default 3s, 5s in Episteme). The new input is silently delayed by the heartbeat interval even though the agent is mid-turn on stale input.

This isn't a bug — interrupting the in-flight turn is the right call. But:
- The user has no signal that anything is queued ("did my message get through?")
- There's no `pending_input` event or property on the agent.
- The Episteme server already implements an app-level `planning.isLocked` to avoid this, suggesting the gap exists.

**Repair option:** Emit a `"queued"` event when `tick()` short-circuits because `isThinking` is true. Or expose `agent.queueDepth: { direct: number; ambient: number }` so UIs can show "1 message waiting."

---

#### F-4 🟠 Synchronous `onInit` errors propagate; async ones are swallowed
**Citation:** `BaseAgent.ts:242`, `BaseAgent.test.ts:139-149`

`Promise.allSettled(this.plugins.map(p => p.onInit?.(this)))` — if a plugin's `onInit` throws synchronously, `p.onInit?.(this)` throws *before* the promise is constructed, propagating out of `start()`. If it rejects asynchronously, it's absorbed. A test already documents this asymmetry, but it's a footgun — Episteme registers 15 plugins; a sync-throwing one halts the whole startup.

**Repair option:** Wrap each call in `Promise.resolve().then(() => p.onInit?.(this))` so sync throws become rejections inside `allSettled`.

---

### Area B — Cancellation & interruption

#### F-5 🔴 `interrupt()` only aborts the LLM call. In-flight plugin work continues.
**Citation:** `BaseAgent.ts:139-142`, `act()` body 580-691

`interrupt()` calls `this.currentAbortController?.abort()` and emits `"interrupt"`. The `AbortSignal` is passed only to `llm.chat()`. None of the plugin hooks (`getContext`, `getSystemPromptFragment`, `executeTool`, `augmentResponse`, `onMessage`, `getMessages`) receive the signal.

Concrete failure modes:
- A long-running `getContext` (CortexMemoryPlugin's vector search) keeps querying after the user interrupted.
- A long-running `executeTool` (ResearchPlugin web fetch, FFmpegPlugin transcode) keeps running and consumes CPU/network/disk. The next tick may already be mid-flight.
- `augmentResponse` plugins keep transforming a response the user no longer wants spoken.
- Memory-write side effects from background extraction (`MemoryPlugin.extractProcedures`) are never cancelled.

**Impact:** Across CortexSubAgent the problem amplifies — when the parent interrupts, sub-agents see "aborted" only when they try to chat next. Their in-flight work has the same orphan-side-effect problem.

**Repair options:**
1. Extend `AgentPlugin` hook signatures to accept an `AbortSignal` (breaking change). Recommend `getContext`, `executeTool`, and `augmentResponse` first — they have the highest blast radius.
2. Expose `agent.signal: AbortSignal` so plugins that need it can read it via the agent ref captured in `onInit` (non-breaking, opt-in).

---

#### F-6 🔴 The retry loop swallows yield interrupts and turns them into "tool error" strings
**Citation:** `BaseAgent.ts:478-509`, `yieldControl` lines 174-190

`yieldControl` rejects its promise with `new Error("Yield interrupted.")` when the abort fires. That rejection propagates up through the tool wrapper's `try { toolResult = await plugin.executeTool!(...) }` block and is caught as a normal error. The retry loop then re-invokes the tool up to `maxAttempts` times — each retry also fails with "Yield interrupted." — and finally returns `"Tool error after N attempt(s): Yield interrupted."` to the LLM, which may incorporate it into its response.

**Repair option:** Special-case a YieldSignal-like error class. Don't retry it; rethrow it so the LLM provider's tool loop can decide what to do (likely abort the whole `actWithTools`).

---

#### F-7 🟠 `currentTickToolCalls` and `currentAbortController` are instance fields — re-entrancy hazard if `tick()` ever runs concurrently
**Citation:** `BaseAgent.ts:50, 66, 582, 593`

The `isThinking` flag is the only thing preventing concurrent `act()` calls. If a future change ever allowed parallel ticks (e.g. for separate "channels" of input), both would scribble over the same `currentTickToolCalls` and `currentAbortController`. Today this is safe but the invariant is invisible — there's no assert or comment binding the lifetime of these fields to a single in-flight act().

**Repair option:** Declare these as locals in `act()` (pass the abort controller down via parameter to `buildTools`'s closure factory if it must read it).

---

### Area C — Context budget & assembly

#### F-8 🟡 No system prompt budget. Every plugin contributes unbounded text on every tick.
**Citation:** `BaseAgent.ts:368-430, 716-740`

`collectSystemPrompt` concatenates every plugin's `getSystemPromptFragment` and every plugin's `getContext` with no truncation, prioritization, or per-plugin budget. Episteme today registers 15 plugins; `EditorContextPlugin` alone injects up to 6 KB of windowed document text each turn (`EditorContextPlugin.ts:34-45`), CortexMemoryPlugin injects retrieved memories, the active plan injects step context with completed-step excerpts (up to ~3 KB).

The framework gives no governor. As applications scale plugin counts, prompt latency and token cost grow linearly with no signal until the LLM truncates silently.

**Repair option:** Add an optional `priority?: number` and `maxChars?: number` to plugin return values, plus a `systemPromptBudgetChars` in `AgentConfig`. When over budget, drop low-priority blocks. Even a soft warning (a `prompt_size_warning` event) would be a substantial improvement.

---

#### F-9 🟠 `historyLimit` is per-plugin, not per-tick
**Citation:** `BaseAgent.ts:336-359`, `MemoryPlugin.getMessages`

`collectMessages` calls `p.getMessages(historyLimit ?? 20)` on each plugin and concatenates. With multiple message-providing plugins (`MemoryPlugin` short-term, plus any plugin that implements `getMessages`), the assembled history can exceed `historyLimit`. Today only `MemoryPlugin` implements `getMessages`, so the limit holds — but the contract is misleading.

**Repair option:** Either document `historyLimit` as a per-plugin hint (and accept the unboundedness) or post-process the concatenated array in `collectMessages` to cap total length. The latter is safer for plugin authors.

---

#### F-10 🟠 `onMessage` is never called for tool calls or tool results, but the docstring suggests it sees "every message"
**Citation:** `BaseAgent.ts:742-757`, `Plugin.ts:92-96`

`dispatchMessage` is called twice per tick: once with the user input (before LLM) and once with the final assistant output (after augment). The 100-round tool loop inside the LLM provider is invisible. Plugins that try to maintain conversation history by hooking `onMessage` are *silently incomplete* — `MemoryPlugin`'s history has only user/assistant exchanges, no record of what tools were called between them. This breaks the assumption in `MemoryPlugin.extractProcedures` that the conversation log contains tool-use rationale (`MemoryPlugin.ts:241-244` looks for tool names via regex on prose because it has no other signal).

**Impact:** Procedure extraction is degraded, behavior extraction misses tool-driven corrections, debugging tool failures from history alone is impossible.

**Repair options:**
1. Emit `onToolMessage(name, args, result)` from the LLM provider's tool callback. Requires threading a callback through `chat()` to the tool implementation wrapper.
2. Emit `tool_call` / `tool_result` events already exist — repurpose them by adding an `onToolEvent` plugin hook that consumes the same data.
3. Move the tool loop *out* of the LLM provider and into BaseAgent. (Biggest change, but it's the only way to make tool dispatch a first-class agent concern instead of a provider concern.)

This is the single largest design constraint in the framework. See §3 Cross-Cutting Themes.

---

#### F-11 🟠 `getLastSystemPrompt()` returns the *most recent* tick's prompt, not the prompt the current LLM call is using
**Citation:** `BaseAgent.ts:234-236, 428`

`MemoryPlugin.summarizeOldContext` uses `agent.getLastSystemPrompt()` to give the summarizer the agent's identity. But summarization runs async, often after subsequent ticks have updated the prompt. The summarizer can end up using a prompt from a *different* turn than the messages it's summarizing.

**Repair option:** Either pass the prompt into the `requestMemoryWrite` payload at write time, or snapshot the prompt into `MemoryPlugin`'s state inside `onMessage` so summarization uses the prompt that was active when the messages were produced.

---

### Area D — Tool dispatch invariants

#### F-12 🟠 Tool cache invalidation is implicit. The "tools never change mid-tick" invariant is enforced only by Episteme's discipline.
**Citation:** `BaseAgent.ts:48, 80-85, 228-231, 437-546`

`cachedTools` is invalidated only in two places: `registerPlugin` and an explicit `invalidateToolCache()` call. Episteme's `ModeGated` wrapper changes `getTools()` output dynamically and calls `invalidateToolCache()` from `activatePlugin`/`deactivatePlugin` (`app-episteme/src/agent.ts:179, 186`). Any future plugin that returns dynamic tools without invalidating will silently serve stale tools — including the stale tool's permission level and retry policy.

This is a real footgun for new agent authors: nothing in the plugin contract says "tools are cached," and there's no warning if a plugin returns different tool lists across `getTools()` calls.

**Repair options:**
1. Hash `getTools()` output and warn when it changes between ticks without `invalidateToolCache()`.
2. Make plugins opt into dynamic tools via a `dynamicTools: true` flag that suppresses caching for that plugin only.
3. Replace polling with an `agent.onToolsChanged()` callback plugins can call.

---

#### F-13 🟠 `onBeforeToolCall` veto runs after permission check, so permission prompts fire even when a plugin would block the call
**Citation:** `BaseAgent.ts:450-471`

The wrapper sequence is: permission → veto → retry → execute → verify. If a plugin would veto a tool call (e.g. a safety plugin saying "never delete files in /etc"), the permission manager has already prompted the user to approve a call that won't run. With `InteractivePermissionManager` this is just an annoying extra prompt; with the AutoApprove manager it's harmless. But UX-wise, the order is wrong.

**Repair option:** Swap the order — veto first, then permission. Plugins doing structural blocking should always run before user-facing prompts.

---

#### F-14 🟠 Tool implementation closures capture `rawTool.retry` and `rawTool.verifyAfter` at cache-build time
**Citation:** `BaseAgent.ts:445, 479, 510`

The wrapper is built once and cached. If a plugin's `getTools()` returns different `retry` or `verifyAfter` policies across calls (legitimate for adaptive plugins), the cache silently serves the policy from the first build. Coupled with F-12, this is the same invariant in two places.

**Repair option:** Resolve `retry`/`verifyAfter` per-call, not at cache build (re-read from the live tool list at dispatch time). Costs negligible per-tick lookups.

---

#### F-15 🟠 Tool implementation has no abort-during-execution
**Citation:** `BaseAgent.ts:472-474`

The wrapper checks `currentAbortController?.signal.aborted` *before* calling `plugin.executeTool`, but not during. A long-running tool (FFmpeg transcode, network fetch) gets no signal. Combine with F-5 and the conclusion is: the framework's interrupt() only stops the LLM, not the work.

**Repair option:** Pass the abort signal to `executeTool(name, args, signal?)`. Plugins that don't accept the signal are unchanged; ones that do can race the signal against their work.

---

#### F-16 🟡 No per-tool timeout. A hung tool stalls the whole agent.
**Citation:** `BaseAgent.ts:482-507`

`maxAttempts` and `delayMs` exist for transient failures, but there's no `timeoutMs` per tool. A network call with no timeout hangs the tick; `isThinking` stays `true`; the proactive timer keeps firing nudges that pile up in the ambient queue but never tick. The whole agent appears dead.

**Repair option:** Add `timeoutMs` to `RetryPolicy` (or a separate `ToolDefinition.timeoutMs`). On timeout, race against the tool with `Promise.race` and return a structured timeout error.

---

### Area E — Plugin contract gaps

#### F-17 🟡 No hook to observe tool calls / results from plugin side
See F-10. Plugins can listen to `tool_call` and `tool_result` events via `onInit(agent) { agent.on("tool_call", …) }`, but events are not in the documented plugin lifecycle. `MetacognitionPlugin` does this (`MetacognitionPlugin.ts:89-90`) but the pattern is undocumented.

**Repair option:** Either formalize event-based introspection as part of the plugin contract (add a `subscriptions?: (agent) => void` lifecycle hook documented for it), or add `onToolCall`/`onToolResult` hooks symmetric with `onMessage`.

---

#### F-18 🟡 `requestMemoryWrite` fires into the void; callers can't tell if anyone listened
**Citation:** `BaseAgent.ts:130-136, types.ts:11-16`

Comment says "graceful no-op" — but a plugin asking to persist something has no way to know whether it persisted. `MemoryPlugin.extractProcedures` fires these into the void; if `CortexMemoryPlugin` isn't registered (HeadlessAgent, tests without memory), the extracted procedure is lost with no log.

**Repair option:** Return `boolean` from `requestMemoryWrite` indicating "at least one listener acknowledged." Requires moving from event emit to a registered broker pattern.

---

#### F-19 🟠 `getMessages` plugins all run, results concatenated, no deduplication
**Citation:** `BaseAgent.ts:336-359`

If two plugins implement `getMessages` (legitimate — `MemoryPlugin` short-term + a workspace-history plugin), the LLM sees both interleaved. There's no contract for "which plugin owns conversation history." Today only one plugin uses this hook in practice, but the gap is real for future agents.

**Repair option:** Designate one plugin as the "history broker" (similar pattern to the memory write broker). Other plugins read it but don't return their own.

---

#### F-20 🟡 No hook for "agent is about to call LLM" / "agent finished LLM call"
A pre-LLM hook would let plugins inject context they couldn't compute in `getContext` (e.g. a "right before we dispatch, snapshot the full prompt"). A post-LLM hook would observe latency and errors more cleanly than the metrics event. Today plugins can subscribe to `state_change` but it doesn't carry payload (the system prompt, the message count, etc.).

**Repair option:** `onBeforeLLM(messages, systemPrompt, tools)` and `onAfterLLM(response)` hooks.

---

### Area F — CortexAgent-specific

#### F-21 🟠 CortexAgent is non-negotiable. No way to skip Metacognition/Yield/Thought.
**Citation:** `CortexAgent.ts:65-72`

Every `CortexAgent` instance gets all four cortex plugins. Episteme inherits Metacognition (which injects `[Metacognition]` blocks into every prompt — see `MetacognitionPlugin`'s `getContext`) whether it wants it or not. CortexSubAgent inherits the same — every dynamically spawned cortex sub-agent runs the full cortex stack, which is heavy for a one-task helper.

**Repair option:** Accept a `cortexPlugins?: { memory?: boolean; thought?: boolean; metacognition?: boolean; yield?: boolean }` config option. Default all true; let consumers turn pieces off. Or split `CortexAgent` into a minimal `MemoryAgent` (just memory) and `FullCortexAgent` (all four).

---

#### F-22 🟠 CortexAgent's `systemPrompt` augmentation is one-shot at construction
**Citation:** `CortexAgent.ts:49-58`

The cortex directives ("You have internal thoughts…", "You may act proactively…", "Question the coherence…") are appended once. If `config.systemPrompt` is updated at runtime (a feature Episteme might want for mode-switching), there's no path — the whole agent must be rebuilt. This is consistent with BaseAgent's design (`config.systemPrompt` is private) but worth flagging as a limit.

**Repair option:** Add `agent.setSystemPrompt(newPrompt: string)` that re-augments and stores. Surface a `system_prompt_updated` event.

---

#### F-23 🟠 `memoryPlugin: public readonly` hard-codes one memory namespace per agent
**Citation:** `CortexAgent.ts:38, 67-69`

Exposing the single memory plugin as a typed field is convenient (DynamicAgentPlugin uses it as `parentMemory`), but it assumes exactly one memory namespace. A future agent that wants per-tenant memory or a separate "private" namespace would need to fork.

**Repair option:** Generalize to `getMemoryPlugin(namespace?: string)` returning the plugin from the registry. Today's single-namespace usage stays the trivial case.

---

#### F-24 🟠 The cortex `<think>` event chain depends on `OllamaProvider` reasoning extraction. Other providers would silently break.
**Citation:** `BaseAgent.ts:626-627`, `ChatResponse.reasoningText`

`act()` emits `"thought"` with `reasoningText` from the chat response. `OllamaProvider` populates this from `message.thinking`. A new provider that doesn't fill the field would silently disable `ThoughtPlugin`'s persistence layer. There's no contract test enforcing reasoningText is populated when the model produces reasoning.

**Repair option:** Either move reasoning extraction into BaseAgent (parse `<think>` tags from `response`), or document `reasoningText` as required-when-model-supports-reasoning and add a contract test for new providers.

---

### Area G — Observability & metrics

#### F-25 🟠 `tick_metrics` doesn't include errors or queue depth
**Citation:** `types.ts:46-78`

`TickMetrics` records latency and sizes, but not: error count, retry count, abort fired, queue depth at start of tick, system prompt char count *per fragment*. Episteme's `/api/metrics` is the production observability surface and it's missing visibility into the metrics that matter most for diagnosing slow agents.

**Repair option:** Extend `TickMetrics` with `{ errored: boolean; retries: number; aborted: boolean; queueDepthAtStart: number; fragmentSizes: Record<string, number> }`.

---

#### F-26 🟠 No way to observe the assembled tool list across ticks
`MetacognitionPlugin.list_available_tools` calls `agent.getAvailableTools()` synchronously; this works but it's pull-based. There's no event when the tool list changes. Episteme's mode-gating produces tool list changes that the UI must poll for via `/api/metrics` or the existing `agent_mode_changed` event (which the app emits manually).

**Repair option:** Emit a `tools_changed` event from `invalidateToolCache()` so consumers don't have to poll.

---

#### F-27 🟠 `interrupt()` returns synchronously even though abort propagation is async
**Citation:** `BaseAgent.ts:139-142`

`interrupt()` calls `abort()` and emits `"interrupt"`. But the in-flight `act()` may take an indeterminate time to actually unwind — the LLM provider has to detect the abort, the tool loop has to finish (or not) the current tool, plugins keep working. Callers have no way to await "agent is idle again." Episteme's WebSocket handler calls `agent.interrupt()` and then immediately processes the next message — which might dispatch into a still-thinking agent that's just about to set `isThinking = false`. The race is mostly benign but real.

**Repair option:** Make `interrupt()` return `Promise<void>` that resolves when the next `state_change("idle")` fires.

---

## 3. Cross-cutting themes

### Theme 1 — The tool loop is owned by the LLM provider, not the agent
F-6, F-10, F-15, F-17 all stem from this. Tools are wrapped by BaseAgent but executed by `OllamaProvider.actWithTools`, which holds the multi-round assistant/tool history in a local variable and discards it on return. Plugins cannot observe, modify, or persist what happens between user input and final response.

**Strategic recommendation:** Pull the tool loop into BaseAgent. This is the single largest improvement — it would:
- Make tool calls visible to `onMessage`
- Let `MemoryPlugin` persist the full tool conversation
- Allow per-tool timeouts at the framework level
- Enable plugins to interrupt the loop mid-round
- Let multiple LLM providers share one tool loop implementation (today each provider duplicates round-counting and abort handling)

The current design exists because Ollama's API supports a native tool format and it was easiest to use it directly. But the cost is that BaseAgent is no longer "the orchestrator" — it's a wrapper around an orchestrator that lives inside a provider.

### Theme 2 — Cancellation is half-implemented
F-5, F-6, F-7, F-15, F-27 all stem from incomplete abort propagation. The framework has an `AbortController` per tick but only passes its signal to one consumer (the LLM). Every async operation triggered by a turn — context collection, tool execution, augment chains, plugin onMessage handlers, background memory writes — runs to completion regardless of interrupt state.

**Strategic recommendation:** Thread `AbortSignal` through every plugin hook. It's a breaking change to the plugin interface, but the migration is mechanical (add `_signal?: AbortSignal` to method signatures). The payoff is real: bargein actually stops the agent.

### Theme 3 — Implicit invariants only Episteme knows about
F-12, F-14, F-19 are all variants of "this works because the only consumer happens to obey an unwritten rule." When Chat and Episteme are the only consumers, this is manageable. As you add more consumers, the rules need to be either documented contracts or enforced invariants.

**Strategic recommendation:** Promote each implicit invariant to either a runtime check (warn when violated) or a typed contract. Examples:
- Tool stability: warn when `getTools()` returns a different list than what's cached.
- History ownership: type `getMessages` so only one plugin per agent can implement it (or document concatenation explicitly).
- Memory broker: register a `MemoryBroker` interface explicitly instead of relying on event listeners.

### Theme 4 — CortexAgent is a façade, not an extension point
F-21, F-22, F-23 all point to CortexAgent being too rigid for the variety of consumers that will use it. The four pre-registered plugins are reasonable defaults but every consumer has a different appetite for them. Today there's no opt-out.

**Strategic recommendation:** Replace the constructor-based plugin registration with a `CortexAgentBuilder` that accepts opt-in flags. Or take the simpler step: change the constructor signature to accept a `cortexOptions: { memory?: …; thought?: …; metacognition?: …; yield?: … }` where `false` disables and an object overrides defaults.

---

## 4. Recommended improvement plan (ranked by ROI)

Ordered by impact ÷ implementation cost. Each item lists the findings it addresses.

| # | Change | Addresses | Cost | Notes |
|---|--------|-----------|------|-------|
| 1 | Move `dispatchMessage("user", …)` to *after* successful LLM call | F-1 | 30 min | Pure correctness fix. Symmetric with assistant dispatch. |
| 2 | Emit `tick_metrics` with `errored: true` from the catch block | F-2, F-25 | 1 hr | Restores visibility on failed turns. |
| 3 | Add `errored`, `retries`, `aborted`, `queueDepthAtStart` to `TickMetrics` | F-25 | 2 hr | Observability win for any agent in production. |
| 4 | Special-case YieldSignal in retry loop; don't retry yield interrupts | F-6 | 1 hr | Tiny code change, real correctness win. |
| 5 | Veto runs *before* permission check | F-13 | 30 min | UX fix; reorder two blocks. |
| 6 | Emit `"queued"` event when `tick()` short-circuits on `isThinking` | F-3 | 1 hr | Unblocks UI improvements in Episteme. |
| 7 | `interrupt()` returns `Promise<void>` resolving on next idle | F-27 | 1 hr | Closes a race in every consumer. |
| 8 | `agent.setSystemPrompt(newPrompt)` runtime mutation | F-22 | 2 hr | Unlocks dynamic system prompts. |
| 9 | Thread `AbortSignal` through `executeTool` | F-5, F-15 | 4 hr | Breaking change to plugin contract. High value. |
| 10 | Add `timeoutMs` to `ToolDefinition` | F-16 | 4 hr | Prevents hung tools from stalling agents. |
| 11 | `CortexAgent` cortex-plugin opt-out via constructor flags | F-21 | 2 hr | Makes CortexAgent fit more use cases. |
| 12 | `onBeforeLLM` / `onAfterLLM` plugin hooks | F-20, F-17 | 6 hr | Enables tool-call observation without provider changes. |
| 13 | Move tool loop from `OllamaProvider` into `BaseAgent` | F-10, F-15, F-17, Theme 1 | 2-3 days | **Largest strategic change.** Pre-requisite for any plugin that needs tool-call visibility. |
| 14 | System prompt budget governor + per-plugin priority | F-8 | 1-2 days | Scales the framework to N plugins without prompt blowup. |
| 15 | Thread `AbortSignal` through every async plugin hook | F-5, Theme 2 | 1-2 days | Completes cancellation. Breaking change. |
| 16 | Per-namespace memory plugin access | F-23 | 1 day | Future-proofs multi-tenancy. |
| 17 | Tool-cache invariant enforcement (warn on dynamic tools without invalidation) | F-12, F-14 | 4 hr | Closes the longest-standing footgun. |

The top 7 items are all under a day's work each, mostly under an hour, and together resolve every 🔴 bug-level finding plus several footguns. They form a clear "first PR" boundary.

The "move tool loop into BaseAgent" item is the keystone change — many downstream improvements depend on it. Consider it before items #14-#17, even though it's larger in isolation, because it changes the shape of the fixes for those items.

---

## 5. Out-of-scope (noted, not investigated)

These surfaced during exploration but are not in the BaseAgent/CortexAgent audit scope:

- `CortexSubAgent` timeout default of 120s is too low for complex tasks (already in memory as a known issue).
- `OllamaProvider.actWithTools` MAX_ROUNDS=100 — intentional per project memory; flagged here only because it interacts with the "tool loop lives in provider" theme.
- `MetacognitionPlugin` is heavy (turn-state tracking + tool-saturation enforcement) and runs on every CortexAgent. Worth a separate audit pass on whether its cost is justified for non-2b agents.
- `OllamaProvider` is the only implementation of `LLMProvider`; the abstraction's resilience to other providers (Anthropic, OpenAI, LM Studio) is untested.
