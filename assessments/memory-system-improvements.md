# Memory System — What Changed

## CortexMemoryDatabase.ts — Full rewrite

The database layer received the most significant changes. Embeddings are now stored as `Float32Array` BLOB instead of JSON text, which eliminates the per-query parse overhead and the intermediate array allocation. A `bufferToFloat32Array` helper handles the round-trip correctly (using `byteOffset` and `byteLength / 4` rather than a naive copy).

Four new columns were added via `ALTER TABLE` migrations that run at startup and are idempotent: `status` (defaults `'active'`), `source`, `confidence`, and `scope`. A `schema_version` table tracks the migration level; bumping to version 2 triggers a one-time JSON→BLOB migration for any rows that still have text embeddings.

All retrieval paths — `searchWithEmbedding`, `getRecentMemories`, `getMemoryTimeline`, `getLinkedMemories` — now hard-filter `status = 'active'` so superseded memories are invisible by default. `updateMemoryStatus(id, status)` is a new method that sets status without touching the text.

Hybrid search gained BM25 fusion: when `filter.contains` is set, FTS5 BM25 scores are normalized to `[0,1]` and blended at `0.7 * vector + 0.3 * bm25`. The `retrieval_method` field on results reflects whether fusion was active.

`getMemoryById` now returns `tags` in its result, enabling callers to inspect tags before acting. `cosSim` was made `public` to support MMR in the plugin layer.

A startup migration (`migrateThoughtTextPrefixes`) strips the old `[THOUGHT] ISO: ` prefix from any existing thought texts in both `memories` and `memories_fts`, making historical data consistent with the new storage format.

---

## CortexMemoryPlugin.ts — Full rewrite

Context injection now uses **Maximal Marginal Relevance** instead of plain top-K. `getContext()` fetches 8 candidates with embeddings included, then `selectWithMMR()` greedily picks the most relevant non-redundant results up to the character budget. Lambda is fixed at 0.6.

Budget parameters are now configurable via `CortexMemoryPluginOptions` (`factualContextBudgetChars`, `procedureContextBudgetChars`) and are threaded through `AgentConfig.memoryOptions` so they can be set from `run.tsx`.

A `lastRetrievalTrace` public property records the ids and scores of everything used in the most recent context injection. The new `memory_retrieval_trace` tool exposes this to the agent at runtime for introspection and debugging.

Conflict resolution no longer mutates text. When `onMessage` detects a high-similarity conflicting memory, it calls `updateMemoryStatus(id, "superseded")` instead of prepending `[SUPERSEDED]` to the text. The original content is preserved; only `status` changes.

Cache invalidation for core behaviors was tightened. Both `handleDeleteMemory` and `handleEditMemory` now check whether the affected memory is actually a core behavior before clearing `coreBehaviorCache`, avoiding unnecessary cache misses on unrelated deletes and edits.

---

## ThoughtPlugin.ts — Rewrite

Thoughts are stored as raw trimmed text with no prefix or embedded timestamp. The timestamp is formatted at read time in `get_recent_thoughts` output: `[ISO] text`. This makes thoughts searchable by content and prevents stale timestamps from being baked into the stored value.

Behavioral insight deduplication switched from exact string comparison to semantic similarity search at threshold 0.92 against existing `behavior` memories. Near-duplicates are silently skipped; only genuinely novel insights are persisted.

---

## types.ts

`AgentConfig` gained `memoryOptions?: { factualContextBudgetChars?: number; procedureContextBudgetChars?: number }` to allow budget tuning at construction time.

---

## CortexAgent.ts

Passes `config.memoryOptions` as the fourth argument to `CortexMemoryPlugin`.

---

## ParentMemoryBridgePlugin.ts — New file

A plugin that sub-agents can use to write memories back to the parent agent's `CortexMemoryPlugin`. Only `factual` and `procedure` types are permitted; attempts to write `behavior` or `thought` are rejected with an explicit error. The `agentName` is passed as `source` so the origin of cross-agent memories is traceable.

---

## CortexSubAgent.ts

Added `registerPlugin(plugin: AgentPlugin): void` delegating to `this.agent.registerPlugin()`. This enables post-construction plugin injection (used by `DynamicAgentPlugin` to attach `ParentMemoryBridgePlugin` after the sub-agent is created but before its first `ask()`).

---

## DynamicAgentPlugin.ts

Added `parentMemory?: CortexMemoryPlugin` to `DynamicAgentPluginOptions`. When set, `buildCortexAgent()` injects a `ParentMemoryBridgePlugin` into every newly created cortex sub-agent.

---

## run.tsx

Passes `parentMemory: agent.memoryPlugin` in the `DynamicAgentPlugin` options, wiring the parent memory bridge for all dynamically spawned cortex agents.

---

## Test updates

`ThoughtPlugin.test.ts`: Updated the storage test to expect raw text (no prefix). Updated the `get_recent_thoughts` test to match the `[ISO timestamp] text` output format.

`CortexMemoryPlugin.test.ts`: The conflict-resolution test no longer checks for `[SUPERSEDED]` in the text. It now verifies the text is unchanged and queries the DB directly to confirm `status === 'superseded'`.
