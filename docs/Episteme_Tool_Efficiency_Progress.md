# Episteme Tool Efficiency — Progress & Context

## Starting point

The Episteme `CortexAgent` registered **67 tools** (~27,871 chars of tool schemas) on every LLM call. LLM inference is ~99.9% of per-turn wall time, so the only meaningful latency lever is reducing bytes sent to the model. Every tool schema adds tokens to every prompt regardless of whether the model uses it that turn.

Baseline from a 22-turn real session:
- `toolCount`: 67
- `toolsChars`: 27,871
- `llmMs` ≈ `totalMs` (LLM dominated entirely)

---

## What was fixed first (bug)

**`CortexAgent.getAvailableTools` was undefined at runtime.**

`CortexAgent` is a façade over `BaseAgent` — it holds `inner: BaseAgent` and proxies all methods. `getAvailableTools()` and `getRegisteredPlugins()` were added to `BaseAgent` (in the metrics endpoint commit) without adding the corresponding pass-throughs on `CortexAgent`. The `/api/metrics` endpoint called these on the `CortexAgent` instance, so they came back `undefined`.

Fix: added both proxy methods to `CortexAgent`.

---

## Phase 1 — Prune dead tools

**Approach:** ran a 22-turn mixed session, collected `/api/metrics`, identified the `neverCalled` list, and removed tools that were dead weight (diagnostic-only, redundant with another tool, or niche workflows that never fire in normal use).

**Decision rule per tool:**
- Is the implementation still needed for server-side direct calls? → keep the handler in `executeTool`, just remove from `getTools()`
- Is it a diagnostic/debug tool that adds schema weight but the model never reaches for? → remove from `getTools()`
- Is it clearly redundant with a simpler tool? → remove entirely

### Removals

| Plugin | Removed | Reason |
|--------|---------|--------|
| MetacognitionPlugin | `show_active_rules`, `list_registered_plugins`, `list_available_tools`, `get_system_prompt`, `efficiency_report`, `show_corrections` | Developer/debug introspection tools. Model never calls them. Handlers kept in `executeTool` so nothing breaks. |
| CortexMemoryPlugin | `get_memory_lineage`, `aggregate_memories`, `get_memory_timeline`, `memory_retrieval_trace` | Diagnostic tail — not core retrieval or storage. Removed from both `getTools()` and the system prompt fragment so the model isn't instructed to use them. |
| FileSystemPlugin | `stat_file`, `patch_file_range` | `list_directory` covers stat; `patch_file` covers the patch use case (model used `patch_file` 11× vs 0 for `patch_file_range`). Error message in `patch_file` updated to suggest `write_file` instead of the removed tool. |
| ResearchPlugin | `unified_search`, `detect_gaps` | `unified_search` is a redundant aggregate of `search_arxiv` + `search_wikipedia` + `search_workspace`. `detect_gaps` never fired and is too niche. |
| WorkspacePlugin | `index_workspace`, `fact_check` | `index_workspace` should be server-triggered (it is), not model-called. `fact_check` overlaps `search_workspace`. |

**Result after Phase 1:** 67 → 51 tools, 27,871 → 22,520 toolsChars (−19%).

---

## Phase 2 — Mode-gated tools

**Approach:** after another 33-turn session, five entire plugin groups had still never fired across ~55 combined turns. Rather than deleting them (they're legitimately useful for specific workflows), they were moved behind a runtime-toggleable mode.

**Design:** a `ModeGated` wrapper class in `agent.ts` proxies all `AgentPlugin` hooks but suppresses `getTools()` and `getSystemPromptFragment()` (returning `[]` and `""` respectively) when `modeState.mode === "standard"`. All other hooks — `onInit`, `executeTool`, `onMessage`, `augmentResponse` — always delegate, so server-side direct calls and background tasks (e.g. ContradictionPlugin's background scan) keep working regardless of mode.

All plugins are registered before `agent.start()`, so `onInit` always fires during the normal start sequence. Mode changes take effect on the next LLM tick without restarting the agent.

**Cache invalidation fix:** `BaseAgent` caches the collected tool list in `cachedTools`. When mode changed, `ModeGated.getTools()` returned the correct new result but the stale cache was returned instead. Fixed by adding `invalidateToolCache()` to `BaseAgent` (and proxied through `CortexAgent`), called from `setMode()`.

### Mode-gated plugins (extended mode only)

| Plugin | Tools | Why gated |
|--------|-------|-----------|
| CitationPlugin | `check_citations`, `format_citation`, `export_citations` | Citation workflows only |
| StyleGuidePlugin | `get_style_guide`, `set_style_guide` | Style-guide workflows only |
| DiagramPlugin | `generate_diagram` | Diagram creation only |
| ContradictionPlugin | `scan_contradictions`, `list_contradictions` | Contradiction scanning only |
| DynamicAgentPlugin | `create_agent`, `call_agent`, `list_agents`, `list_capabilities`, `delete_agent` | Orchestration/sub-agent workflows only |

**UI:** a Layers icon button in the header (next to Focus mode). Lit when extended. Tooltip explains what extended adds. Calls `POST /api/agent-mode` and syncs local state on success. Mode is also readable via `GET /api/agent-mode`.

**Result after Phase 2:** standard mode is 38 tools (~19,000–20,000 toolsChars). Extended mode restores all 51.

---

## Current state

| Metric | Before | After Phase 1 | After Phase 2 (standard) |
|--------|--------|---------------|--------------------------|
| Tool count | 67 | 51 | 38 |
| toolsChars | 27,871 | 22,520 | ~19,000–20,000 |
| Reduction | — | −19% | ~−30% from original |

### Standard mode tools (38)

**FileSystem (12):** `read_file`, `write_file`, `patch_file`, `append_file`, `list_directory`, `find_files`, `search_in_files`, `move_file`, `copy_file`, `delete_file`, `delete_directory`, `make_directory`

**CortexMemory (10):** `search_memory`, `save_memory`, `save_procedure`, `edit_memory`, `delete_memory`, `get_linked_memories`, `query_memories`, `hybrid_search`, `synthesize_memories`, `reflect_on_topic`

**Behavior (5):** `save_behavior`, `synthesize_behaviors`, `activate_profile`, `force_behavior`, `suppress_behavior`

**Research (4):** `ingest_url`, `ingest_pdf`, `search_arxiv`, `search_wikipedia`

**Workspace (3):** `search_workspace`, `get_workspace_section`, `list_workspace_files`

**Metacognition (2):** `introspect`, `memory_status`

**Thought (1):** `get_recent_thoughts`

**Yield (1):** `yield_control`

### Extended adds 13 more
Citation (3) + StyleGuide (2) + Diagram (1) + Contradiction (2) + DynamicAgent (5)

---

## What was observed but not yet acted on

- **Memory tools never called across ~55 turns.** All 10 CortexMemory tools and all 5 Behavior tools have zero calls. The agent is not using its own memory system. This is a description/instruction problem, not a tool surface problem — the tools are in the prompt, the model just doesn't reach for them. Possible causes: the system prompt doesn't make memory feel necessary, or the model doesn't see a clear trigger.

- **`find_files` never called.** The model uses `list_directory` and `search_in_files` instead. `find_files` (glob-based) may be poorly positioned relative to these alternatives.

- **`yield_control` never called.** May require specific cooperative-turn patterns that haven't come up.

---

## Files changed

| File | What changed |
|------|-------------|
| `packages/framework/src/core/CortexAgent.ts` | Added `getAvailableTools()`, `getRegisteredPlugins()`, `invalidateToolCache()` proxy methods |
| `packages/framework/src/core/BaseAgent.ts` | Added `invalidateToolCache()` method |
| `packages/framework/src/plugins/MetacognitionPlugin.ts` | Removed 6 tools from `getTools()` (handlers kept); updated system prompt fragment |
| `packages/framework/src/plugins/CortexMemoryPlugin.ts` | Removed 4 diagnostic tools from `getTools()`; updated system prompt fragment |
| `packages/framework/src/plugins/FileSystemPlugin.ts` | Removed `stat_file`, `patch_file_range`; updated system prompt fragment and error message |
| `packages/framework/src/plugins/FileSystemPlugin.test.ts` | Updated test expecting the new error message |
| `packages/app-episteme/src/plugins/ResearchPlugin.ts` | Removed `unified_search`, `detect_gaps` |
| `packages/app-episteme/src/plugins/WorkspacePlugin.ts` | Removed `index_workspace`, `fact_check` |
| `packages/app-episteme/src/agent.ts` | Added `ModeGated` wrapper; mode-gated 5 plugins; exposed `modeState` + `setMode()` on bundle |
| `packages/app-episteme/src/server/index.ts` | Added `GET/POST /api/agent-mode` endpoints |
| `packages/app-episteme/src/App.tsx` | Added Layers icon mode toggle button |
