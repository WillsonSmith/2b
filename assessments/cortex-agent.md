# Assessment: CortexAgent

**Files covered:**
- `src/core/CortexAgent.ts`
- `src/core/BaseAgent.ts`
- `src/core/types.ts`
- `src/core/Plugin.ts`
- `src/plugins/CortexMemoryPlugin.ts`
- `src/plugins/ThoughtPlugin.ts`
- `src/plugins/CortexMemoryDatabase.ts`
- `src/agents/AgentFactory.ts` (integration point)

---

## Step 1 — Interface Contract

`CortexAgent` does not implement a formal TypeScript interface. It is a concrete class that wraps `BaseAgent` via composition and re-exposes every public method through explicit one-liner delegations. `BaseAgent` extends `EventEmitter` and is also a concrete class. Neither satisfies a shared interface that the other also satisfies.

The practical consequence is that call sites must type against concrete classes — there is no `IAgent` or `AgentLike` interface that both honour. If a consumer holds a `CortexAgent`, they cannot substitute a plain `BaseAgent`, and vice versa, even though the public API surface is identical. Any future refactoring that introduces a second wrapper (e.g. a `RecordingAgent`) would have no interface to satisfy.

The class accepts a generic `TEvents extends AgentEventMap = AgentEventMap`. This propagates to the `on`, `once`, and `off` method signatures, giving callers a typed event subscription surface. However, the inner `BaseAgent` is stored as `private inner: BaseAgent` (unparameterised), so the type parameter only tightens the outer facade — the underlying emitter retains the default `AgentEventMap` type, meaning TypeScript's structural check on the inner `.on()` call is looser than what the outer signature advertises.

`ToolDefinition.parameters` in `Plugin.ts:7` is typed `any` (JSON Schema), and `ToolDefinition.implementation` is `(args: any) => any | Promise<any>`. All tool arguments flow through as `any` throughout the system. This is a broad escape hatch that propagates into `CortexMemoryPlugin.executeTool` and `ThoughtPlugin.executeTool`, where `args` is never narrowed.

---

## Step 2 — Constructor and Configuration

```ts
constructor(llm: LLMProvider, config: AgentConfig, synthesisProvider: LLMProvider | null = null)
```

**`llm`** is passed to both `BaseAgent` (for main chat calls) and `CortexMemoryPlugin` (for generating embeddings). The memory plugin uses the same model for both conversation and vector search. There is no separate `embeddingModel` field in play here — `AgentConfig.embeddingModel` exists in the type but is never read by `CortexAgent` or `CortexMemoryPlugin`, making it a dead configuration key.

**`config.cortexName`** determines the SQLite filename via the fallback `config.cortexName ?? config.name ?? "cortex"`. If neither field is set, all agents share the same `data/cortex.cortex.sqlite` database. There is no guard or warning against this; silent memory pollution between agents would result. The field is defined in `AgentConfig` (a shared type used by both `BaseAgent` and `CortexAgent`), but `BaseAgent` never reads it — it is only meaningful to `CortexAgent`.

**`synthesisProvider`** defaults to `null`, which disables thought-to-behavior synthesis entirely. In the only current deployment (`AgentFactory.ts`), no synthesis provider is passed, so this feature is always off. There is no log message or observable signal indicating that synthesis is disabled, making it invisible to operators.

**System prompt extension** appends three fixed lines unconditionally:
- "You have internal thoughts stored in thought memory. Review recent thoughts before responding."
- "You may act proactively — don't only respond to explicit requests."
- "Question the coherence of ideas you encounter. Look for contradictions."

These are joined after the caller's `config.systemPrompt` with no deduplication. If the caller's prompt already includes equivalent instructions, they are repeated. There is no way to opt out of the cortex directives without subclassing or forking.

---

## Step 3 — Delegation Layer

Every public method on `CortexAgent` is a one-liner forwarding to `this.inner`. This is a clean delegation pattern, but it introduces one notable omission: `BaseAgent` exposes a `addPerception(text, opts?)` method (`BaseAgent.ts:61`) described as a "backward-compatible shim" that routes `[Heard ...]` and `[User said ...]` prefixes to `directQueue` and everything else to `ambientQueue`. `CortexAgent` does not delegate this method, so callers holding a `CortexAgent` cannot call `addPerception` without casting to `BaseAgent` (which is private). Any plugin or input source that calls `addPerception` on the agent reference received in `onInit` would still work, since `onInit` receives the inner `BaseAgent` directly — but this is an asymmetry in the public API.

The `memoryPlugin` field is `public readonly`, which exposes `CortexMemoryPlugin` and transitively its `db: CortexMemoryDatabase` field (also public) to all external callers. This was intentionally designed for callers like `SubAgentPlugin` to access memory directly, but it violates encapsulation and creates a coupling path that bypasses the plugin lifecycle.

---

## Step 4 — ThoughtPlugin Lifecycle and Timing Dependencies

`ThoughtPlugin.onInit` subscribes to the `"thought"` event on the `BaseAgent` instance it receives. This event is emitted at `BaseAgent.ts:245` after the LLM response is received, with the extracted `reasoningText`. The subscription works correctly because `inner.start()` calls `plugin.onInit(this)` where `this` is the `BaseAgent`.

However, there is a fragile implicit ordering dependency in `CortexMemoryPlugin`. The `onMessage` method runs autonomous conflict resolution using `this.currentEvents`, which is populated by `getContext()` at `CortexMemoryPlugin.ts:54`. The ordering relies on `BaseAgent.act()` calling `getContext()` before `dispatchMessage()` — which is currently true, but is not enforced by types or contracts. If the call order in `act()` were changed (e.g. to parallelise context collection), `this.currentEvents` would be stale or empty during conflict resolution.

The synthesis path in `ThoughtPlugin` is entirely fire-and-forget: `this.synthesizeAndStore(thought).catch(...)` at line 41. If the synthesis provider is flaky or returns unexpected output, the failure is silently swallowed into a `logger.error` call and the behavior memory is simply not saved. This is arguably the right trade-off for a non-critical path, but there is no circuit-breaker or backoff if the provider is consistently failing.

---

## Step 5 — CortexMemoryPlugin: Auto-surfacing and Tool Paths

`getContext()` is called every LLM turn. It generates an embedding for the combined current input, then calls `searchWithEmbedding` twice with different thresholds and type filters. `searchWithEmbedding` (`CortexMemoryDatabase.ts:165`) performs a **full table scan** — it loads every row from the `memories` table (optionally filtered by type), deserialises each stored JSON embedding, and computes cosine similarity in-memory. As the memory store grows, this will become a significant per-turn latency cost. There is no indexing, no approximate nearest-neighbour strategy, and no upper bound on how many rows are loaded.

Auto-linking (`executeTool` for `save_memory`, lines 320–323) runs `db.search()` after insertion to find similar memories and calls `db.linkMemories()` for each. This linking only happens when the LLM explicitly calls `save_memory`. Memories written by `ThoughtPlugin` via direct `db.addMemory()` calls are **never auto-linked**. The two write paths have different behaviours with no documentation of this asymmetry.

The `onMessage` conflict resolution threshold is 0.85, which is described as targeting contradictory memories. In practice cosine similarity at 0.85 means highly semantically similar text — not necessarily logically contradictory. Two memories that say the same thing in different words will both survive (scores < 0.85), but two genuinely contradictory statements about the same subject may score 0.88 and trigger deletion. The conflict detection is topic-overlap, not logical contradiction.

`onMessage` deletes recent conflicting memories (< 2 hours old) entirely and marks older ones as `[SUPERSEDED]`. Both mutations happen outside of a transaction. The `savedThisTurn` set prevents memories saved in the current turn from being immediately deleted, but this set is cleared at the start of each `getContext()` call, not at the start of each turn, making its scope subtly turn-aligned via side-effect rather than explicit lifecycle.

---

## Step 6 — CortexMemoryDatabase: Persistence and Integrity

**No transaction boundaries.** `addMemory` performs two separate writes: `INSERT INTO memories` and `INSERT INTO memories_fts`. `deleteMemory` performs three writes. `updateMemoryText` performs two writes (UPDATE memories, UPDATE memories_fts). None of these are wrapped in `BEGIN / COMMIT`. A process crash between any pair of statements will leave the database in an inconsistent state where the FTS index diverges from the main table.

**`llm` field is typed `any`** (`CortexMemoryDatabase.ts:19`). The provider's `getEmbedding(text: string): Promise<number[]>` method is called duck-typed. There is no compile-time guarantee that the passed provider implements this method, and no runtime check.

**Embedding storage as JSON text.** Each embedding vector is serialised as a JSON string and stored in a `TEXT` column. Deserialisation happens on every `searchWithEmbedding` call for every row in the filtered set. For a 1536-dimension embedding (typical for OpenAI-compatible models), each row parse is non-trivial and the approach does not scale.

**Migration check is read-only-safe but runs every startup.** `initSchema()` queries `PRAGMA table_info(memories)` and conditionally runs `ALTER TABLE` statements on every constructor call. For a long-running process this runs once, but for tests or repeated agent instantiation it adds unnecessary database round-trips.

**`getMemoryTimeline` uses `getContext`-style alias inconsistency.** The timeline query omits the `m.` alias (`memories ${whereClause}` without alias), whereas `queryMemories` uses `memories m`. This is a stylistic inconsistency that could cause confusion if `buildWhereClause` output is ever reused across both paths.

---

## Step 7 — Integration Context (AgentFactory)

In `AgentFactory.ts`, `CortexAgent` is instantiated with `cortexName: "2b"` and no `synthesisProvider`. Four `SubAgentPlugin` instances are registered after construction. Each sub-agent is a `HeadlessAgent` — a stateless task-in/task-out agent — which does not use `CortexMemoryPlugin` at all. The orchestrator's memory is not shared with sub-agents, and sub-agents have no memory of their own.

The `systemPrompt` in `AgentFactory.ts` explicitly warns (in a code comment) that the context-injection instruction for sub-agents is "prompt-based only" and "fragile". This is an acknowledged design gap: there is no structural mechanism to inject orchestrator context into sub-agent calls, relying entirely on the LLM following the instruction to include relevant facts in the `task` string.

`MemoryPlugin` (short-term conversation history, separate from `CortexMemoryPlugin`) is also registered. This means the orchestrator has two memory plugins active: `CortexMemoryPlugin` for long-term semantic memory and `MemoryPlugin` for rolling conversational history. Their interactions — particularly whether `MemoryPlugin.getMessages()` and `CortexMemoryPlugin.getContext()` produce redundant context — are not documented.

---

## Step 8 — Error Handling and Visibility

`BaseAgent.act()` wraps the entire execution path in a try-catch that emits `"error"` and calls `plugin.onError()`. This means a failure during any phase (embedding generation, LLM call, tool execution) surfaces as an event rather than a thrown exception. Callers who do not register an `"error"` listener will see the `EventEmitter` default behaviour of throwing an unhandled error.

Individual plugin calls in `act()` are wrapped in their own try-catches with `logger.error` only, so a plugin failure never propagates to the agent-level error path. This means a `CortexMemoryPlugin.getContext()` failure is logged but invisible to the caller — the agent continues with an empty context. There is no way for a plugin to signal a fatal error that should abort the tick.

`ThoughtPlugin.executeTool` and `CortexMemoryPlugin.executeTool` both return `undefined` for unknown tool names (implicitly, via falling off the end of the if-chain wrapped in try-catch). The `BaseAgent` tool dispatch does not distinguish between "tool not found" and "tool returned undefined result" — both produce `undefined` which is passed back to the LLM as the tool result. This could confuse the model if it calls a tool by a slightly wrong name.

---

## Summary Table

| Area | Severity | Issue |
|---|---|---|
| Interface contract | Medium | No shared interface between `CortexAgent` and `BaseAgent`; callers bind to concrete classes, making substitution and testing harder |
| Generic `TEvents` | Low | Type parameter only tightens the outer facade; inner `BaseAgent` remains unparameterised, so the constraint is partially fictional |
| `AgentConfig.embeddingModel` | Low | Field exists in `AgentConfig` but is never read by `CortexAgent` or `CortexMemoryPlugin`; dead configuration key |
| `cortexName` fallback | High | Fallback to `"cortex"` means all agents with no `name` or `cortexName` share one SQLite database; silent memory pollution |
| `synthesisProvider` default | Low | Defaults to `null` (disabled) with no log or signal; operators have no indication the feature is inactive |
| Hardcoded cortex directives | Low | Three fixed instructions are appended unconditionally; no way to opt out or deduplicate if the caller's prompt already contains them |
| `addPerception` not delegated | Low | `BaseAgent.addPerception()` is a public method not exposed by `CortexAgent`; asymmetric public API |
| `memoryPlugin` public | Medium | Exposes `CortexMemoryPlugin` and its `db` publicly; callers can bypass plugin lifecycle and write directly to SQLite |
| Timing dependency in conflict resolution | Medium | `CortexMemoryPlugin.onMessage` depends on `this.currentEvents` being populated by a prior `getContext()` call in the same turn; implicit ordering not enforced by contract |
| Full table scan on every turn | High | `searchWithEmbedding` loads all embedding rows into memory on every LLM tick; will degrade significantly as memory store grows |
| Auto-linking asymmetry | Medium | Auto-linking only runs when LLM calls `save_memory`; thoughts written by `ThoughtPlugin` via `db.addMemory()` are never linked |
| Conflict resolution by similarity, not logic | Medium | 0.85 cosine similarity detects topically similar memories, not logically contradictory ones; legitimate reinforcing memories may be falsely deleted |
| `savedThisTurn` lifecycle | Low | Set is cleared in `getContext()` rather than at the start of each turn; scope is turn-aligned by side-effect rather than explicit lifecycle management |
| No transaction boundaries in database writes | High | `addMemory`, `deleteMemory`, `updateMemoryText` perform multiple writes without transactions; a crash between statements leaves FTS and main table out of sync |
| `llm` typed as `any` in database | Medium | `CortexMemoryDatabase.llm` is `any`; no compile-time guarantee the provider implements `getEmbedding()` |
| Embeddings stored as JSON text | Medium | Storing/loading embedding vectors as serialised JSON strings on every similarity search is not scalable and adds parse overhead per row per turn |
| Migration runs on every startup | Low | `initSchema()` runs `PRAGMA table_info` and conditional `ALTER TABLE` on every constructor call, adding unnecessary I/O |
| Tool `undefined` result ambiguity | Medium | Unknown tool names and tools that legitimately return `undefined` are indistinguishable; the LLM receives `undefined` as the tool result with no error signal |
| Synthesis fire-and-forget with no backoff | Low | Synthesis failures are silently swallowed; no circuit-breaker if the synthesis provider is consistently unavailable |
| `MemoryPlugin` + `CortexMemoryPlugin` overlap | Low | Both plugins are active in `AgentFactory`; potential for redundant context injection is undocumented and unmanaged |
| Sub-agent context injection is prompt-only | Medium | No structural mechanism ensures orchestrator context reaches sub-agents; acknowledged in a comment as fragile and error-prone |
