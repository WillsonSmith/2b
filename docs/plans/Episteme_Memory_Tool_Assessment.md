# Episteme Memory Tool Assessment

Companion to `Episteme_Memory_Tool_Exploration.md`. Read-only investigation; no source changes.

## 0. Evidence base

Production database inspected: `~/…/Philosophy/.episteme/agent.sqlite` — a real workspace with weeks of usage across many sessions.

**Memories by source × type (active + superseded):**

| Source | factual | procedure | thought | behavior |
|---|---:|---:|---:|---:|
| `MemoryPlugin` (short-term overflow auto-summarizer) | 32 | 16 | — | — |
| `thought-plugin` (auto-captures `<think>` blocks) | — | — | 137 | — |
| `research` (`ResearchPlugin` → `writeMemory`) | 6 | — | — | — |
| `BehaviorPlugin` (the only LLM-driven path that fired) | — | — | — | 2 |
| **`save_memory` / `save_procedure` (LLM tool calls)** | **0** | **0** | — | — |

`memory_links` table: 2 rows (both `related`). `contradictions`: 0 rows.

The zero-invocation metric from the tool-efficiency work isn't an anomaly — it is the steady-state of this system. All useful memory is produced by framework-triggered writes; the LLM-facing tool surface contributed two behaviors over weeks.

## 1. Findings table — per-tool verdict

| Tool | Plugin | What it does | Fired in prod? | Verdict |
|---|---|---|---|---|
| `search_memory` | CortexMemory | Semantic search, optional type filter | No | **Redundant.** `getContext()` already injects top-5 MMR factual + 1 procedure + 2 recent thoughts every turn against the current user query. The LLM has no felt need to call it. |
| `save_memory` | CortexMemory | Save a factual/thought/behavior/procedure with optional `supersedes` | No | **Mostly redundant.** Short-term overflow auto-summarizer captures the same content; `requestMemoryWrite` covers programmatic producers. Keep as a single "remember this verbatim" escape hatch — that *one* use case isn't covered. |
| `save_procedure` | CortexMemory | Save numbered steps after a non-trivial task | No | **Delete.** `MemoryPlugin.extractProcedures()` runs an LLM pass during summarization and writes `[AUTO_EXTRACTED]` procedure memories. The DB already has 16 of these; zero came from the tool. |
| `save_behavior` | Behavior | Save a behavioral rule with weight/tags | 2× in weeks | **Needs better trigger, not better description.** The descriptions are crisp; the LLM still does not reach for it. The 2 saves were both during sessions where the user said "remember to X". Genuine gap — covered in §3. |
| `synthesize_behaviors` | Behavior | LLM-merge two conflicting behaviors | No | **Conditional on conflicts existing.** With only 2 behaviors, no conflicts exist to resolve. Keep — cheap to expose, justified when behavior count grows. |
| `activate_profile` | Behavior | Force-load behaviors tagged with a name | No | **Delete or hide.** Speculative API that depends on user-tagged profile clusters that don't exist in real data. |
| `force_behavior` / `suppress_behavior` | Behavior | Session-scoped pin/exclude by ID | No | **Delete.** Asks the LLM to manage session UI state via opaque memory IDs. Power-user surface area; no evidence of demand. |
| `edit_memory` | CortexMemory | Update text of a memory by ID | No | **Delete from LLM surface; keep server API.** The web UI uses `editMemory()` directly. Asking the LLM to edit by UUID is not a real workflow. |
| `delete_memory` | CortexMemory | Delete one or many by ID | No | Same — **delete from LLM surface; keep server API**. |
| `get_linked_memories` | CortexMemory | Follow `memory_links` for a memory ID | No | **Delete.** Only 2 link rows in production; the LLM has no signal to ask for "linked memories of this ID" because it never has an ID in mind. |
| `query_memories` | CortexMemory | Metadata filter (type / tags / dates / contains) | No | **Delete.** Overlaps with `search_memory` and `hybrid_search`; the LLM never picks the right one. If any survives, it's `hybrid_search`. |
| `hybrid_search` | CortexMemory | Vector + BM25 + filters | No | **Candidate for retention as the single search tool** — but only if §3 chooses "keep tools, fix prompts." Otherwise also delete. |
| `synthesize_memories` | CortexMemory | LLM-consolidate memories across types into one insight | No | **Delete.** Reflection-style helper that the auto-surfacing context already supplies passively. Adds latency and prompt weight for no observed benefit. |
| `reflect_on_topic` | CortexMemory | Two-pass synthesis + saves "behavioral insight" | No | **Delete.** Same category. The "deep" path also writes an LLM-generated behavior back into memory — high-confidence noise generator. |

**Bottom line:** of 14 tools across the two plugins, **2 are doing real work in production** (`save_behavior`, and indirectly via writeMemory — which isn't a tool — `ResearchPlugin` writes). The remaining 12 are zero-use.

## 2. Answers to the three goal questions

**1. Should the memory tools exist at all?**
Mostly no. The framework already covers retrieval (`getContext` injects MMR-selected memories every tick) and the majority of writes (`MemoryPlugin` auto-summarises short-term overflow into factual + procedure memories; `ThoughtPlugin` captures reasoning blocks; `ResearchPlugin` writes its outputs directly via `writeMemory`). The tool surface is a parallel write/read path that the LLM never chooses because it has no signal that anything is missing — relevant memories are already in the prompt and short-term context is summarised before it overflows. Read tools (`search_memory`, `query_memories`, `hybrid_search`, `get_linked_memories`) are pure redundancy. Save tools are redundant *except* for `save_behavior`, which captures a distinct kind of content the auto-paths don't produce.

**2. Why are the memory tools not being called?**
Two reasons, in order of weight. (a) **Redundancy** — every retrieval need is satisfied by automatic injection; every save need except behavior is satisfied by the auto-summarizer. The LLM has no felt-gap to reach for a tool. (b) **Workflow mismatch** — explicit memory ops by UUID (`edit_memory`, `delete_memory`, `get_linked_memories`, `force_behavior`, `suppress_behavior`) are designed for a model that holds memory IDs in working memory; the LLM never has IDs because nothing in the conversation surfaces them. Tool descriptions are not the bottleneck — they're already specific and verb-led.

**3. What's the right architecture going forward?**
**Trim hard, add one auto-extractor for behaviors.** Cut 10 of the 14 tools (see §1 table); keep `save_memory` as a single "remember this verbatim" escape hatch and `hybrid_search` for the rare case a user explicitly invokes search. Add a `BehaviorExtractor` pass to the existing `MemoryPlugin` summarisation: when summarising overflow, also extract `prefers/avoid/always/when X do Y` style statements and write them through `writeMemory(…, "behavior", …)` — same architectural pattern as `extractProcedures()`. This closes the only genuine gap revealed by the data (behaviors under-captured) without adding new LLM-facing tools.

## 3. Recommended direction

**Hybrid leaning heavily on framework-triggered writes — "delete most, auto-extract behaviors."**

Concretely:

1. **Delete from LLM tool surface** (keep underlying methods for server/REST callers): `search_memory`, `save_procedure`, `edit_memory`, `delete_memory`, `get_linked_memories`, `query_memories`, `synthesize_memories`, `reflect_on_topic`, `activate_profile`, `force_behavior`, `suppress_behavior`. That is **11 tools removed** from the catalog without losing any real-world capability.
2. **Keep**: `save_memory` (single explicit "remember this"), `hybrid_search` (single explicit search), `save_behavior` (explicit behavior capture), `synthesize_behaviors` (only useful once behavior count > ~10 — retain).
3. **Add (framework-side, no new tools):** extend `MemoryPlugin`'s summarisation pass with an `extractBehaviors()` step parallel to the existing `extractProcedures()`. Same prompt shape: scan the summarised window for stated preferences/rules; `requestMemoryWrite({ type: "behavior", weight: 0.5, source: "MemoryPlugin:auto" })`. The existing dedup in `writeMemory` (0.92 threshold) handles duplicates.
4. **Trim the system-prompt fragment** in `CortexMemoryPlugin.getSystemPromptFragment()` to drop the long list of tool-naming bullets — that real estate is now spent on dead capability. Replace with: "Relevant memories are surfaced automatically each turn. Use `save_memory` only when the user explicitly says 'remember this'. Use `hybrid_search` only when the user explicitly asks you to search."

**Why this:** the evidence shows the framework is already doing the work; the tool surface is largely prompt-weight tax. The one genuine miss (behaviors) is fixable with the same pattern that already works for procedures. Nothing in the recommendation requires re-architecting the embedding pipeline, the storage backend, or `getContext`.

**Trade-offs:**
- **Prompt-size impact:** strictly positive — fewer tools in the catalog, shorter system prompt fragment.
- **Latency impact:** one extra LLM call per summarisation cycle (behaviour extraction), but summarisation only fires when short-term hits 15 messages. Amortised cost is small.
- **What we lose:** the ability for the LLM to do multi-hop reasoning over its own memory (`get_linked_memories`, `synthesize_memories`). The data shows it never did this anyway. If a real use case emerges, re-expose `hybrid_search` + `get_memory_lineage` selectively.
- **What gets harder:** explicit memory inspection from inside the agent (e.g., "what behaviors do I have active right now?"). Metacognition's `show_active_rules` and `memory_status` already cover this — they remain on the surface.

## 4. Open questions

- **User intent confirmation needed.** The framing assumption (Episteme memory = long-term writing-session context + style learning + fact recall) was inferred from the data. Confirm before deleting tools — if the user does want LLM-driven multi-hop memory ops (e.g., reflective journaling sessions where the agent intentionally walks its own memory), the calculus changes.
- **`save_behavior` floor.** 2 saved behaviors in weeks is low, but the auto-extractor proposal assumes that's *too low*. If 2 is in fact the right rate (the user prefers a sparse, hand-curated behavior set), do **not** add auto-extraction — the proposal collapses to "just trim the tools."
- **`ContradictionPlugin` zero-hit rate.** No contradictions detected across the whole workspace, despite the plugin being mode-gated and the user clearly maintaining a large philosophy workspace. Is the threshold too strict, the prompt too narrow, or is this genuinely a low-contradiction corpus? Out of scope here but worth a follow-on.
- **Cost-vs-benefit of `extractBehaviors`.** Worth running the extraction over the existing 32 `SESSION_SUMMARY` blobs as a one-shot backfill to estimate yield before committing to the per-summarisation cost. If a single sample run produces < 1 quality behavior per 5 summaries, skip the auto-extractor and just trim tools.

## 5. What this assessment did not investigate

Per the exploration plan's "out of scope": embedding model, similarity thresholds, SQLite vs other storage, cross-agent memory, the unrelated `find_files` / `yield_control` zero-call entries. Those remain follow-on items.
