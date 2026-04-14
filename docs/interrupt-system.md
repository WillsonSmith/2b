# Interrupt System — Implementation Reference

Branch: `feat/interrupt-system`  
Status: implemented, committed, tests passing

---

## What Was Built

A complete interrupt/stop system allowing a user to cancel an in-flight agent response mid-execution — including cancelling spawned sub-agents and their tool calls. A "■ Stop" button was added to the web UI.

---

## Architecture Overview

The interrupt flows top-down through three layers:

```
WebSocket "interrupt" message
  → ChatSession.interrupt(scope)
    → CortexAgent.interruptAll()
      → BaseAgent.interruptAll()
        → BaseAgent.interruptSubAgents()   # cancels sub-agents
            → DynamicAgentPlugin.interruptAll()
                → HeadlessAgent.interrupt()   # aborts each active sub-agent's LLM call
                → CortexSubAgent.interrupt()  # same for cortex sub-agents
        → BaseAgent.interrupt()            # aborts orchestrator's own LLM call
```

Each LLM call receives an `AbortSignal`. When `.abort()` is called, the signal propagates into the Ollama/LMStudio HTTP streaming call and through tool execution checks.

---

## Files Changed

### `src/providers/llm/LLMProvider.ts`
Added `abortSignal?: AbortSignal` as the 6th parameter to `chat()`.

### `src/providers/llm/OllamaProvider.ts`
- Threaded `abortSignal` through `chat()` → `actWithTools()` / `respond()` / `callWithStructuredTools()`
- In `actWithTools()`: **critical fix** — replaced all `abortSignal?.aborted` property checks with a local `aborted` flag driven by an `addEventListener("abort", ...)` listener (see "Key Bug" below)
- Abort checks at: round start, post-stream, before each tool in `Promise.all`
- `signal: abortSignal` passed to `this.client.chat()` for HTTP-level cancellation

### `src/providers/llm/LMStudioProvider.ts`
- Threaded `abortSignal` through `chat()` → `actWithTools()` / `respond()`
- In `actWithTools()`: `if (abortSignal?.aborted) throw new Error("Interrupted.")` before each tool call
- In `respond()`: `if (abortSignal?.aborted) break` inside the fragment loop

### `src/core/BaseAgent.ts`
- `act()` passes `this.currentAbortController.signal` to `llm.chat()`
- `buildTools()` checks `this.currentAbortController?.signal.aborted` before calling `executeTool()` — returns `{ error: "Interrupted." }` if aborted
- Added `interruptSubAgents()` — duck-types over plugins looking for one with `interruptAll()` (avoids circular imports with DynamicAgentPlugin)
- Added `interruptAll()` — calls `interruptSubAgents()` then `interrupt()`

### `src/core/CortexAgent.ts`
CortexAgent is a **façade** over BaseAgent, not a subclass. Every public method must be explicitly proxied. Added:
- `interruptSubAgents()` → `this.inner.interruptSubAgents()`
- `interruptAll()` → `this.inner.interruptAll()`

(Missing these caused the first runtime bug: `TypeError: this.agent.interruptAll is not a function`)

### `src/core/HeadlessAgent.ts`
- Added `private currentAbortController: AbortController | null = null`
- Added `interrupt()` method: `this.currentAbortController?.abort()`
- `ask()` creates an AbortController, passes its signal to `llm.chat()`, clears it in `finally`
- Tool wrapper checks `this.currentAbortController?.signal.aborted` before `executeTool()` — if aborted, returns `{ error: "Interrupted." }` without running the tool

### `src/core/CortexSubAgent.ts`
- Added `interrupt()` → delegates to `this.agent.interrupt()`
- `doAsk()` registers an `onInterrupt` listener on `"interrupt"` event; when fired, settles the promise with `reject(new Error("[interrupted]"))`
- All settlement paths (onSpeak, onError, onInterrupt, timer) clean up all three event listeners
- Fixed **askQueue poisoning**: changed `.then(() => this.doAsk(task))` to `.catch(() => {}).then(() => this.doAsk(task))` — prevents a rejected ask (interrupt/timeout) from blocking all future asks
- Constructor's permanent error handler filters out abort-caused errors (`"aborted"` / `"[interrupted]"` in message) to avoid spurious `agent_error` UI state

### `src/plugins/DynamicAgentPlugin.ts`
- Updated `AskableAgent` interface: added `interrupt?(): void`
- Added `private readonly activeAsks = new Set<AskableAgent>()`
- `callAgent()` adds agent to `activeAsks` before `ask()`, removes in `finally`
- Added `interruptAll()` — iterates `activeAsks`, calls `agent.interrupt?.()` on each
- Added `interruptAgent(name)` — interrupts a specific named agent if it has an active ask

### `src/ui/ChatSession.ts`
- `AgentLike` type extended with `interruptSubAgents()` and `interruptAll()`
- `interrupt(scope: "main" | "subagents" | "all" = "all")`:
  - `"all"` → `agent.interruptAll()` + clears pending message + clears active tools
  - `"subagents"` → `agent.interruptSubAgents()` only (main agent continues)
  - `"main"` → `agent.interrupt()` only

### `src/ui/web/server.ts`
```ts
case "interrupt": {
  const scope = msg.scope as "main" | "subagents" | "all" | undefined;
  session.interrupt(scope ?? "all");
  break;
}
```

### `src/ui/web/WebApp.tsx`
Stop button rendered when `state === "thinking"`:
```tsx
{state === "thinking" && (
  <div className="stop-area">
    <button className="stop-btn" onClick={() => sendToWs({ type: "interrupt", scope: "all" })}>
      ■ Stop
    </button>
  </div>
)}
```

### `src/ui/web/styles.css`
Added `.stop-area` and `.stop-btn` styles.

### `src/ui/ChatSession.test.ts`
- Added `interruptSubAgents = mock(() => {})` and `interruptAll = mock(() => {})` to `MockAgent`
- Updated test assertion: default scope `"all"` calls `agent.interruptAll()`, not `agent.interrupt()` directly

---

## Key Bug: OllamaProvider AbortSignal in Bun

**Symptom**: After interrupt, sub-agents continued running for 20+ rounds. Tool wrappers returned `{"error":"Interrupted."}` (proving the signal WAS aborted), but `abortSignal?.aborted` checks in `actWithTools()` consistently returned falsy — the loop never short-circuited.

**Root cause**: In Bun's runtime, when an `AbortSignal` is aborted from a different microtask context (e.g., interrupt called while a `for await` stream or a `Promise.all` is suspended), the `.aborted` property getter does not reflect the new state synchronously by the time the round-start check runs. The `"abort"` event, however, always fires eagerly.

The tool wrapper checks (`this.currentAbortController?.signal.aborted`) worked because they reference the AbortController instance directly on the HeadlessAgent object, not through the parameter that was captured into the OllamaProvider closure.

**Fix** (in `OllamaProvider.actWithTools()`):
```ts
let aborted = abortSignal?.aborted ?? false;
const onAbort = () => { aborted = true; };
abortSignal?.addEventListener("abort", onAbort);

try {
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (aborted) { return interrupted; }
    // ... stream ...
    if (aborted) { return interrupted; }
    // ... tools ...
    // else if (aborted) { result = "Interrupted."; }
  }
} finally {
  abortSignal?.removeEventListener("abort", onAbort);
}
```

All `abortSignal?.aborted` checks replaced with `aborted`. The event listener sets the flag in the same microtask as `.abort()`, making it visible on all subsequent synchronous checks.

---

## Runtime Bugs Encountered and Fixed

1. **`TypeError: this.agent.interruptAll is not a function`**  
   Cause: CortexAgent proxies BaseAgent manually — new methods on BaseAgent don't automatically appear on CortexAgent. `interruptSubAgents` and `interruptAll` were added to BaseAgent but not forwarded in CortexAgent.  
   Fix: Added proxy methods to `CortexAgent.ts`.

2. **Agents continue using tools after interrupt**  
   Cause: `AbortSignal` was only checked before each LLM call, not before each tool execution. Once the model returned tool calls, all of them executed before the next round-start check.  
   Fix: Added abort checks inside `buildTools()` (BaseAgent) and `ask()` (HeadlessAgent) tool wrappers, plus in `Promise.all` map inside `actWithTools()`.

3. **`abortSignal?.aborted` never true in OllamaProvider round loop (Bun runtime bug)**  
   Described in detail above.

4. **`askQueue` poisoning in CortexSubAgent**  
   Cause: `this.askQueue = this.askQueue.then(...)` — if a prior ask() rejected (interrupt/timeout), the rejection propagated to all future `.then()` calls, blocking the queue permanently.  
   Fix: `.catch(() => {}).then(() => this.doAsk(task))`.

---

## What Remains / Follow-up Opportunities

- The `abortSignal?.aborted` approach in `LMStudioProvider` was not changed to use the event listener pattern — it may have the same Bun issue if LMStudio is used. The fix pattern from OllamaProvider should be applied there if LMStudio interrupt also proves unreliable.
- The `interruptSubAgents()` duck-typing approach in `BaseAgent` only finds the FIRST plugin with an `interruptAll()` method. If multiple orchestration plugins existed, only one would be interrupted. Currently DynamicAgentPlugin is the only such plugin so this is fine.
- `TerminalChat.tsx` was intentionally not modified (constraint from original spec).
