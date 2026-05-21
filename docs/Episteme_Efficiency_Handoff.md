# Episteme Agent Efficiency — Handoff

You're picking up a performance-optimization effort on the Episteme agent. The metrics pipeline is already built; your job is to use it to identify and implement efficiency wins.

## TL;DR

The Episteme `CortexAgent` registers 13 tool-providing plugins for a combined **67 tools** (~27,871 chars of tool schemas) on **every single LLM call**. Real measurements show LLM inference is **~99.9% of per-turn wall time**, so prompt-size reductions are the only meaningful latency lever. We want to cut the tool surface that the model sees per turn without losing functionality.

## What's been built (don't redo this)

A per-tick metrics pipeline:

- `TickMetrics` type — `packages/framework/src/core/types.ts`
  - Per-phase timings (`totalMs`, `llmMs`, `collectMessagesMs`, `collectSystemPromptMs`, `augmentMs`, `dispatchMs`)
  - Size measurements (`systemPromptChars`, `toolsChars`, `historyChars`)
  - `pluginContextMs: Record<string, number>` — per-plugin `getSystemPromptFragment + getContext` time
  - `toolCount`, `contextContributors`
  - `toolsCalled: Record<string, number>` — per-tool invocation count for the tick
  - `ignored: boolean` — true if the model emitted `[IGNORE]` on an ambient turn
- Emitted on `tick_metrics` event by `BaseAgent` — `packages/framework/src/core/BaseAgent.ts`
- Rolling 50-tick aggregator — `packages/framework/src/core/TickMetricsAggregator.ts` (snapshot returns averages, per-plugin breakdown sorted by `avgMs` desc, per-tool counts sorted by `totalCalls` desc)
- HTTP endpoint — `GET /api/metrics` in `packages/app-episteme/src/server/index.ts` returns:
  ```jsonc
  {
    "sampleCount": 28,
    "ignoredCount": 0,
    "avg": { /* averaged TickMetrics fields */ },
    "pluginContextMs": [ { "name": "Behavior", "avgMs": 118, "maxMs": 240, "samples": 28 }, ... ],
    "toolsCalled": [ { "name": "read_file", "totalCalls": 17, "ticksUsed": 12, "callsPerTick": 0.6 }, ... ],
    "registeredToolCount": 67,
    "registeredTools": [ /* sorted */ ],
    "neverCalled": [ /* registered minus called */ ],
    "plugins": [ { "name": "FileSystemPlugin", "toolCount": 8 }, ... ]
  }
  ```

Tests: `BaseAgent.test.ts` ("BaseAgent - tick_metrics" describe block) and `TickMetricsAggregator.test.ts`. **Pre-existing failures unrelated to this work**: `BaseAgent - yieldControl > yieldControl emits agent_yield event` (arg-order bug in test) and ~8 failures in `CortexMemoryPlugin.test.ts` and the `save_behavior` / `delete_memory` suites. Don't try to fix these — they're baseline.

## The efficiency thesis

Per-turn cost breakdown from a 28-turn real session:

- `llmMs` ≈ `totalMs` (LLM is essentially all the wall time)
- `toolsChars` ≈ 27,871 — tool schemas are ~7k tokens of every prompt
- Plugin context cost: `Behavior` (118ms avg) and `CortexMemory` (103ms avg) dominate; all other plugins under 7ms
- `toolCount` = 67

Because LLM dominates, the optimization target is **bytes-into-the-prompt per turn**, primarily the tool surface. Reducing 67 tools to ~15 cuts ~5k tokens from *every* LLM call. Over a long session this is the dominant savings opportunity.

## What you should do

**First — collect fresh data.** Don't act on the numbers in this doc; they're from one session and may not be representative. Have the user run Episteme for 20-30 turns of mixed work (writing, research, code, planning) and call:

```bash
curl http://localhost:<port>/api/metrics | jq '{neverCalled, topUsed: .toolsCalled[:10], plugins: (.plugins | sort_by(-.toolCount))}'
```

The `neverCalled` list is the cheapest win. Tools that don't fire across a representative session are dead weight — they either have descriptions the model doesn't recognize, are overshadowed by similar tools, or aren't useful in current workflows.

**Then implement, ranked by impact-per-effort:**

### Phase 1 — Prune dead tools (low effort, immediate)
For each tool in `neverCalled`:
- Find the owning plugin via `grep -r "name: \"<tool>\"" packages/`
- Check if the tool is actually obsolete or if the description is bad
- If obsolete: delete the tool from the plugin's `getTools()` and its `executeTool()` case
- If description-poor: rewrite the description and re-measure next session

Expect 20-30% surface reduction with no architectural change.

### Phase 2 — Tool modes (medium effort, biggest single win)
Group plugins into runtime-toggleable modes — e.g., `write` / `research` / `code` / `plan`. Each mode loads ~3-5 plugins → ~15-20 tools.

- Add a runtime mode field to the agent config or workspace state
- Expose UI toggle (precedent: the existing distraction-free button)
- Conditionally call `agent.registerPlugin()` based on active mode (note: `BaseAgent.cachedTools` is invalidated by `registerPlugin`, but there's no `unregisterPlugin` yet — you'll need to add one, or restart the agent when the mode changes)
- Always-on plugins (`CortexMemoryPlugin`, `BehaviorPlugin`, `EditorContextPlugin`, `PlanningPlugin`, `ThoughtPlugin`, `MetacognitionPlugin`, `YieldPlugin`) should never be in a mode group

Modes are predictable, zero extra LLM cost, and the user already mentally switches between tasks.

### Phase 3 — Sub-agents (higher effort, more depth)
`DynamicAgentPlugin` is already wired in `packages/app-episteme/src/agent.ts:103`. Carve narrow specialists whose tool schemas don't appear in the main agent's prompt:

- `ResearchAgent` — owns `ResearchPlugin` + `CitationPlugin`
- `DiagramAgent` — owns `DiagramPlugin` + `AIFillPlugin`
- `WriterAgent` — owns `StyleGuidePlugin` + `ContradictionPlugin`

The main agent keeps ~10 essentials plus `delegate_to(agent, task)`. See `packages/framework/src/agents/sub-agents/createCodebaseExplainerAgent.ts` for the established pattern.

## What NOT to do

- **Don't add a classifier-LLM router.** When LLM is 99.9% of latency, adding a router call doubles cost unless the router is dramatically faster than the main model. The user knows their task; let them choose a mode.
- **Don't refactor plugins broadly.** Each plugin is independent; touch only the ones you're modifying.
- **Don't break the plugin API.** Other code (`packages/app-2b/`) shares the framework. Additive changes only.
- **Don't try to fix the pre-existing test failures.** They're baseline.

## Architectural constraints

- This is a **Bun monorepo**. Use `bun test` (not jest/vitest), `bun:sqlite` (not better-sqlite3), `Bun.serve()` (not express). See root `CLAUDE.md`.
- Plugin lifecycle hooks all run in `Promise.allSettled` — a throwing plugin doesn't crash the agent. Don't rely on hook ordering for correctness.
- `CortexAgent` is the preferred top-level class; it auto-registers `CortexMemoryPlugin`, `ThoughtPlugin`, `MetacognitionPlugin`, `YieldPlugin`. Detailed plugin docs in `packages/framework/src/core/CLAUDE.md` and `packages/framework/src/plugins/CLAUDE.md`.
- The Episteme agent bundle is assembled in `packages/app-episteme/src/agent.ts`.

## Verifying changes

After each change:
1. Run `bun test packages/framework` and confirm only the known-pre-existing 10 failures remain
2. Restart Episteme (`bun run episteme`), do a representative session, hit `/api/metrics`
3. Check `toolsChars` dropped, `toolCount` dropped, `neverCalled` shrunk, and the tools the user actually needs still appear in `toolsCalled`

The goal is a measurable drop in `toolsChars` (and therefore prompt tokens) without losing functionality the user relies on. Re-measure after each phase; don't stack optimizations blindly.
