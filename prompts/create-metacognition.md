# Implement a MetacognitionPlugin for the 2b Agent Framework

## Goal
Create a `MetacognitionPlugin` that makes the agent's own cognitive processes visible to
itself in real-time — surfacing memory retrieval metadata, active behavioral rules, tool
usage patterns, and uncertainty signals. This is NOT a logging tool for developers; it's
self-awareness infrastructure that shapes how the agent reasons.

## Codebase Context

**Plugin system:** All capabilities are plugins implementing the interface in
`src/core/Plugin.ts`. The 8 lifecycle hooks are:
- `onInit(agent)` — subscribe to agent events, initialize state
- `getSystemPromptFragment()` — inject static instructions every LLM call
- `getContext(events?)` — inject dynamic context every LLM call
- `getTools()` — expose callable tools to the LLM
- `executeTool(name, args)` — handle tool calls
- `onMessage(role, content, source)` — react to messages
- `augmentResponse(response)` — transform response before emission
- `onError(error)` — handle errors

**Agent events:** `BaseAgent` emits `tool_call` (name, args) before every tool execution.
Use `agent.on('tool_call', ...)` in `onInit` to intercept all tool calls across all plugins.

**Existing memory tools** (from `CortexMemoryPlugin`):
- `search_memory`, `query_memories`, `hybrid_search` — retrieval
- `save_memory`, `save_behavior`, `save_procedure`, `edit_memory`, `delete_memory`
- `get_linked_memories`, `aggregate_memories`, `get_memory_timeline`

**ThoughtPlugin** already captures `<think>` blocks and synthesizes behavioral rules.
`behavior` type memories in `CortexMemoryDatabase` are auto-injected into system prompt.

**SQLite backend:** `CortexMemoryDatabase` at `src/plugins/CortexMemoryDatabase.ts` handles
all storage and search. The `searchMemories` method returns `MemoryRecord[]` — read it to
understand the return shape before modifying.

## Implementation

### Step 1 — Enrich `CortexMemoryDatabase.searchMemories()`

Modify `searchMemories()` to return retrieval metadata alongside results. Add a new return
type that includes, per result:
- `confidence_score`: the cosine similarity score (already computed — surface it)
- `total_candidates`: count of records checked before filtering
- `filter_applied`: which fields were used to filter (type, tags, etc.)
- `retrieval_method`: `"semantic"` | `"fulltext"` | `"hybrid"`

Update `CortexMemoryPlugin`'s tool implementations to pass this metadata through as a
separate field in the tool result (e.g., `_meta: { ... }`). Do not change the primary
result shape that the LLM sees — add metadata as a side-channel.

### Step 2 — Create `src/plugins/MetacognitionPlugin.ts`

Build a plugin that maintains **per-turn cognitive state** and exposes it to the agent.

**State to track (reset each turn, keyed by turn_id):**
```typescript
interface TurnState {
  turn_id: string;            // uuid
  started_at: Date;
  tool_calls: ToolCallRecord[];
  memory_access_count: number;
  external_tool_count: number;
  behavioral_rules_active: string[];  // names of behavior memories injected this turn
  uncertainty_markers: string[];
}

interface ToolCallRecord {
  tool: string;
  args_summary: string;       // first 100 chars of JSON args, no sensitive content
  category: "memory" | "external" | "system" | "other";
  timestamp: Date;
  result_meta?: Record<string, unknown>;  // the _meta side-channel from Step 1
}
```

**`onInit(agent)`:**
- Subscribe to `tool_call` events to populate `TurnState.tool_calls`
- Subscribe to `speak` events to finalize and archive the turn state
- Categorize tools: memory tools → `"memory"`, web/shell/download/ytdlp/ffmpeg →
  `"external"`, else `"system"` or `"other"`
- Detect tool saturation: if `memory_access_count > 5` in a turn, add
  `"tool_saturation"` to `uncertainty_markers`

**`getContext()`:**
Return a brief introspection summary injected into every system prompt:

```
[Metacognition]
Turn: <turn_id>
Memory accesses this turn: <N> (<tool_saturation warning if applicable>)
Active behavioral rules: <comma-separated list or "none">
Last tool: <most recent tool name or "none">
Uncertainty: <markers or "none">
```

Keep this under 10 lines. This is the AI's "inner state awareness."

**`getSystemPromptFragment()`:**
Return a static instruction block that teaches the agent to use its own metacognition:

```
You have metacognition tools available. Before searching memory, state your intent with
[Memory Search: <query>]. After tool-heavy turns, reflect on whether your reasoning relied
on retrieval or inference. Use the introspect tool to examine your current cognitive state.
Flag assumptions explicitly rather than presenting them as facts.
```

**`getTools()`:** Expose three tools:

1. **`introspect`** — Returns the full current `TurnState` as formatted text including
   all tool calls, memory access count, active rules, and uncertainty markers.

2. **`memory_status`** — Calls `aggregate_memories` internally (or queries
   `CortexMemoryDatabase` directly) and returns counts by type: factual, thought,
   behavior, procedure. Also reports the current turn's memory access count and whether
   tool saturation occurred.

3. **`show_active_rules`** — Retrieves all `behavior` type memories from
   `CortexMemoryDatabase` (these are the rules currently injected into the system prompt)
   and displays them with their tags and creation date. These ARE the active behavioral
   rules.

**`onMessage(role, content, source)`:**
- When `role === "assistant"`: scan content for hedging language ("I think", "probably",
  "I'm not sure", "I believe", "might be") and append `"hedged_language"` to
  `uncertainty_markers` if found
- When `role === "user"`: start a new `TurnState` (new turn_id, reset counters)

### Step 3 — Register in `CortexAgent`

In `src/agents/CortexAgent.ts`, import and register `MetacognitionPlugin` alongside
`CortexMemoryPlugin` and `ThoughtPlugin`. Place it last so it can observe the other
plugins' tool calls.

### Step 4 — Update `src/plugins/CLAUDE.md`

Add `MetacognitionPlugin` to the plugin catalog with a description of its tools and the
cognitive state it tracks.

## Constraints

- Do NOT log raw message content — only tool names, arg summaries (truncated), and
  category labels
- The `getContext()` summary must stay brief — it's injected every LLM call and adds to
  token cost
- `show_active_rules` should read from the database directly, not maintain a separate
  list — behavior memories ARE the active rules
- Tool saturation threshold (5) should be a configurable constructor parameter with
  default 5
- Use `bun:sqlite` directly if you need to query `CortexMemoryDatabase` internals; don't
  add a new ORM
- Follow existing plugin conventions: constructor accepts `options?` object, all hooks
  are async-safe, errors never throw (log via `console.warn`)

## Files to Create/Modify

- **Create:** `src/plugins/MetacognitionPlugin.ts`
- **Modify:** `src/plugins/CortexMemoryDatabase.ts` — enrich search return type
- **Modify:** `src/plugins/CortexMemoryPlugin.ts` — pass through `_meta` side-channel
- **Modify:** `src/agents/CortexAgent.ts` — register the new plugin
- **Modify:** `src/plugins/CLAUDE.md` — add to plugin catalog
