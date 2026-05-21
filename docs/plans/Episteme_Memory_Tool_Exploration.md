# Episteme Memory Tool Exploration — Plan

## Context

Earlier tool-efficiency work surfaced a striking metric: across ~55 turns of real Episteme usage, **all 10 CortexMemory tools and all 5 Behavior tools fired zero times.** Mode-gating those tools is not an option — they're foundational, always-on, and the agent's long-term memory depends on them.

The Episteme system already does *implicit* memory: `CortexMemoryPlugin.getContext()` runs an embedding search every tick and injects the top-N relevant memories into the prompt. So the agent already "sees" relevant memory — what it never does is *explicitly act on it* via tools (no `search_memory`, no `save_memory`, no `save_behavior`).

User hypothesis: tools tend to be called only when the user explicitly invokes them ("search your memory…"). Users don't say that, so the tools sit idle. Auto-surfacing handles retrieval, but nothing handles explicit *creation* or *targeted lookup* — and it's unclear whether those are needed at all.

This is an **exploration plan only** — no code edits, no fixes. The output is a written assessment that answers three questions and recommends a direction.

## Framing assumption

Before diagnosing *why tools aren't called*, establish *whether they should be*. The zero-invocation metric is only a problem if the tools serve a purpose that isn't being served otherwise. The exploration should treat "delete the tools" as a first-class possible outcome, not a fallback.

What is memory *supposed to accomplish* in Episteme? Best read from the source: long-term context across writing sessions, preference/style learning, fact recall about the user's drafts and topics. Flag any assumption here as "needs user confirmation" in open questions.

## Goals — three questions to answer

1. **Should the memory tools exist at all?** Given auto-surfacing already injects relevant memories every tick, and given the zero-invocation metric, is the tool surface adding capability or just adding prompt weight? A clean answer of "delete most of them" is acceptable.

2. **Why are the memory tools not being called?** Conditional on the answer to (1) being "they should exist": is it a description problem (tool descriptions don't trigger the LLM), a redundancy problem (auto-surfacing already covers the need), a prompt problem (system prompt doesn't push toward saving), or a workflow problem (the user-facing tasks just don't require explicit memory ops)?

3. **What's the right architecture going forward?** Should memory remain tool-shaped (LLM chooses), shift to framework-triggered (heuristics or hooks save/search automatically — similar pattern to the auto-activation work just landed), a hybrid, or just be trimmed? Where else could memory be improved — schema, retrieval ranking, write-side defaults?

## Investigation areas

Each area lists the files to read and the questions that area should answer. No edits — read-only exploration.

### Area 1 — How memory is currently injected per turn

**Files:**
- `packages/framework/src/plugins/CortexMemoryPlugin.ts`
- `packages/framework/src/memory/` (CortexMemoryDatabase, embedding pipeline)
- `packages/framework/src/core/CortexAgent.ts` (memory wiring)

**Questions:**
- What does `getContext()` inject every tick? Top-N by embedding similarity? With what cutoff?
- What does `getSystemPromptFragment()` say about memory? Specifically — does it tell the model *when* to use the tools, or only *what* the tools do?
- How does the agent decide which memories to surface — is it scoring against the latest user message, the whole turn context, or something else?
- Are there hooks like `onMessage` that auto-extract facts? Or is saving purely tool-driven?

### Area 2 — The tool surface itself

**Files:**
- `packages/framework/src/plugins/CortexMemoryPlugin.ts` (`getTools()`)
- `packages/framework/src/plugins/BehaviorPlugin.ts` (`getTools()`)
- `packages/framework/src/plugins/CLAUDE.md` (descriptions, conventions)

**Questions:**
- List every memory/behavior tool with its current description (one table for the write-up).
- For each: what signal would the LLM see in conversation that should trigger it? Is the description specific enough to fire that signal?
- Redundancy: do `save_memory`, `save_behavior`, `save_procedure` overlap? Could a single `save` tool with a `type` field be clearer to the model than three separate verbs?
- Coverage: are there obvious memory operations *not* exposed as tools? (e.g., "forget topic X", "summarize what we know about Y")

### Area 3 — Where auto-surfacing succeeds and fails

**Files:**
- `packages/framework/src/plugins/CortexMemoryPlugin.ts` (`getContext` + `search_memory`)
- Real metrics: `GET /api/metrics` (`neverCalled` list) over multiple sessions
- `packages/framework/src/plugins/MetacognitionPlugin.ts` — the `memory_status` tool and any saturation tracking

**Questions:**
- When the user asks a multi-hop question ("how did my view on X change between draft A and draft B?"), does auto-surfacing return the right memories, or would explicit `search_memory` / `query_memories` do better?
- Is there evidence (in metrics or saved memories) of *useful* facts being mentioned and then lost because nothing saved them?
- What's the relationship between Episteme's WorkspaceDB knowledge graph and CortexMemory? Do they serve the same role? Different ones? Are they competing?

**Success criterion:** produce 2–3 concrete worked examples (real or synthesized from existing memories) where you can compare what auto-surfacing returns vs. what tool-based search would return. Without examples, this question gets answered by intuition.

### Area 4 — Behavior vs. memory tools

**Files:**
- `packages/framework/src/plugins/BehaviorPlugin.ts`
- `packages/framework/src/plugins/CortexMemoryPlugin.ts` (specifically `save_behavior`)

**Questions:**
- Two plugins seem to share territory: `BehaviorPlugin` has its own tool set, but `CortexMemoryPlugin` also has `save_behavior`. What's the boundary? Is this two-paths-to-the-same-thing confusing to the LLM?
- How is a "behavior memory" used at retrieval time — is it always injected (like behavior rules) or only when relevant by embedding?
- Could behavior storage be implicit (extracted from corrections in the conversation) rather than tool-driven?

### Area 5 — Alternative architectures

This is the synthesis area — informed by 1–4, sketch options and trade-offs.

**Sketch each option with concrete examples:**

- **Keep as tools, fix the prompts.** Rewrite system prompt fragments with explicit triggers ("when the user states a preference, call `save_behavior`"). Lowest risk, but already tried implicitly via the existing prompt — unclear it'll move the needle.

- **Framework-triggered (no tools).** Same pattern as the auto-activation work just landed: heuristics on user+AI text trigger saves automatically. E.g., user message contains "I prefer X over Y" → `save_behavior("Prefers X over Y")` runs without the LLM deciding. Tools either removed or kept as overrides.

- **Hybrid.** Auto-save common patterns (preferences, stated facts, decisions); keep tool surface for explicit "remember this" / "what did I say about X" requests. Tools become a power-user override, not the default path.

- **LLM-as-saver in a separate pass.** After each turn, a small cheap LLM call extracts memory candidates from the exchange. Independent of the main turn — no impact on prompt size, no reliance on the main model reaching for tools. **Cost note: this doubles per-turn LLM calls.** Weigh honestly against the others; cheap doesn't mean free.

- **Delete most of them.** If auto-surfacing handles retrieval and information loss on the save side turns out to be minor or already covered by WorkspaceDB, the right move may be to delete the tool surface entirely (or keep one explicit "remember this" tool). Frees prompt budget; aligns with the tool-efficiency work already in flight.

For each, note: prompt-size impact, latency impact, what kind of memory it captures well/poorly, and what becomes hard.

## Method

- Read the source files listed above, in order.
- Capture findings as you go in a scratch file (or directly in the deliverable).
- If a question depends on real metrics, run a short Episteme session and capture `/api/metrics` — but don't block the write-up on metrics if the source already gives a clear answer.
- No edits to source. No experiments. This is reading + thinking + writing.

## Deliverable

A markdown document at `docs/plans/Episteme_Memory_Tool_Assessment.md` containing:

1. **Findings table** — every memory/behavior tool with current description and a verdict: `delete` / `redundant-with-X` / `useful-as-is` / `needs-better-description` / `candidate-for-auto-trigger`.
2. **Answers to the three goal questions**, each in one paragraph.
3. **Recommended direction** — pick one of the four architectures above, with two-or-three-sentence justification and an explicit list of what would need to change.
4. **Open questions** — anything the source alone couldn't answer; flag as needing real-session data or user input.

Target length: tight enough to read in five minutes, detailed enough that the follow-on implementation plan can be written without re-exploring.

## Out of scope

- Any code edit
- Performance optimization of the embedding pipeline
- Memory storage backend changes (SQLite vs. anything else)
- Cross-agent memory (Episteme ↔ 2b chat agent)
- The `find_files` and `yield_control` never-called tools from the same metric (separate cleanup, not memory-related)
- Changes to embedding model or similarity threshold (in-scope concerns may surface here in Area 3, but tuning is a follow-on, not part of this assessment)
