# Episteme Tool Auto-Activation — Handoff

## What this work is

Right now the Layers button in the Episteme header is a manual binary toggle: **standard** (38 tools) or **extended** (51 tools). The user wants the extended tools to activate automatically when they're actually needed — e.g. using the diagram editor should make `generate_diagram` available to the agent without requiring a manual toggle.

Read `docs/Episteme_Tool_Efficiency_Progress.md` first. It explains the tool surface reduction work that preceded this and the current architecture.

## Current architecture (what you're building on)

`packages/app-episteme/src/agent.ts` has a `ModeGated` wrapper class:

```typescript
class ModeGated implements AgentPlugin {
  constructor(private inner: AgentPlugin, private state: { mode: AgentMode }) {}
  getTools() { return this.state.mode === "extended" ? (this.inner.getTools?.() ?? []) : []; }
  getSystemPromptFragment(ctx?) { return this.state.mode === "extended" ? ... : ""; }
  // all other hooks always delegate
}
```

Five plugins are wrapped: `CitationPlugin`, `StyleGuidePlugin`, `DiagramPlugin`, `ContradictionPlugin`, `DynamicAgentPlugin`.

A shared `modeState: { mode: "standard" | "extended" }` object is mutated by `bundle.setMode(mode)`, which also calls `agent.invalidateToolCache()` so the change takes effect on the next tick.

`POST /api/agent-mode { mode }` is the REST endpoint. `GET /api/agent-mode` returns current mode.

## The change: per-plugin activation instead of binary mode

Replace the binary `mode: "standard" | "extended"` with a **set of active plugin names**:

```typescript
// before
const modeState: { mode: AgentMode } = { mode: "standard" };

// after
const activePlugins = new Set<string>(); // plugin names currently active
```

`ModeGated` checks `activePlugins.has(this.inner.name)` instead of `mode === "extended"`.

Expose two functions on the bundle:
- `activatePlugin(name: string)` — adds to set, invalidates tool cache
- `deactivatePlugin(name: string)` — removes from set, invalidates tool cache

The bundle also needs a way to read active state: `isPluginActive(name: string): boolean`.

## Trigger map — what activates which plugin

Each extended plugin has one or more clear usage signals already flowing through the server. Hook into these to auto-activate:

| Plugin name | Agent tools | Trigger | Where in server |
|-------------|-------------|---------|-----------------|
| `Diagram` | `generate_diagram` | `diagram_request` WS message | `handleEditor` dispatch, `server/index.ts:131` |
| `Citation` | `check_citations`, `format_citation`, `export_citations` | `check_citations_request` or `format_citation_request` WS | `handleResearch` dispatch, `server/index.ts:147` |
| `Contradiction` | `scan_contradictions`, `list_contradictions` | `contradiction_scan_request` or `contradictions_request` WS | `handleResearch` dispatch, `server/index.ts:143` |
| `StyleGuide` | `get_style_guide`, `set_style_guide` | `PATCH /api/style-guide` HTTP | `server/index.ts:365` |
| `DynamicAgent` | `create_agent`, `call_agent`, `list_agents`, etc. | **No UI trigger** — see below |

`DynamicAgent` is the odd one out. There's no editor action that signals "user wants sub-agent orchestration." Don't try to auto-activate it. Keep it under the manual Layers button (or a separate dedicated button). The four others all have clean triggers.

## Activation scope: session-only, no decay

Activate once per session, stay active. Don't implement decay ("deactivate after N turns of non-use") in this pass — it adds complexity without clear benefit and can be added later. Once the user opens the diagram tool, the agent should have diagram awareness for the rest of the session.

## What to build

### 1. Refactor `ModeGated` and `agent.ts`

Change `ModeGated` to take `activePlugins: Set<string>` instead of `{ mode: AgentMode }`. Everything else in the wrapper stays the same.

Update `createEpistemAgent` to:
- Create `const activePlugins = new Set<string>()`
- Wrap mode plugins with `new ModeGated(plugin, activePlugins)`
- Expose `activatePlugin`, `deactivatePlugin`, `isPluginActive` on the bundle
- Remove `modeState` and `setMode` (or keep `setMode` as a convenience that adds/removes all extended plugin names at once — useful for the manual Layers button)

### 2. Update the server trigger points

In `server/index.ts`, call `bundle.activatePlugin(name)` at the right moment:

- **`diagram_request`** case (line ~131): before dispatching to `handleEditor`, call `bundle.activatePlugin("Diagram")`
- **`check_citations_request` / `format_citation_request`** cases (~147): call `bundle.activatePlugin("Citation")`  
- **`contradiction_scan_request` / `contradictions_request`** cases (~143): call `bundle.activatePlugin("Contradiction")`
- **`PATCH /api/style-guide`** handler (~365): call `bundle.activatePlugin("StyleGuide")`

### 3. Update `/api/agent-mode` endpoint

Change the response shape to reflect the new per-plugin model:

```jsonc
// GET /api/agent-mode
{
  "activePlugins": ["Diagram", "Citation"],  // currently active extended plugins
  "availablePlugins": ["Citation", "StyleGuide", "Diagram", "Contradiction", "DynamicAgent"]
}
```

`POST /api/agent-mode` body options:
- `{ "activate": "Diagram" }` — activate one plugin
- `{ "deactivate": "Diagram" }` — deactivate one plugin  
- `{ "mode": "extended" }` — activate all (backward compat for Layers button)
- `{ "mode": "standard" }` — deactivate all (backward compat for Layers button)

### 4. Update the Layers button in `App.tsx`

The button currently just toggles between "standard" and "extended". With per-plugin state, change it to:
- **Standard**: Layers button unlit, clicking activates all extended plugins
- **Extended (some)**: Layers button half-lit or show a count badge (e.g. `⧉ 2`) — indicates some extended tools are active
- **Extended (all)**: Layers button fully lit, clicking deactivates all

Alternatively, keep the Layers button as a full-all/clear-all toggle and let auto-activation handle the per-plugin granularity. That's simpler and probably fine for now.

The frontend needs to poll or track which plugins are active. On mount, fetch `GET /api/agent-mode`. On each auto-activation (triggered by using a feature), the state updates server-side; the frontend can re-fetch or listen for a new WS message type `{ type: "agent_mode_changed", activePlugins: string[] }`.

## What NOT to do

- **Don't add a classifier LLM** to predict which tools are needed. The usage signal is already available from the WS messages — no inference needed.
- **Don't implement decay** (auto-deactivation after N turns). Premature complexity.
- **Don't try to auto-activate DynamicAgent**. Leave it for manual activation.
- **Don't change the `ModeGated` hook delegation** — all non-tool hooks (`executeTool`, `onInit`, `onMessage`, etc.) must always delegate regardless of active state. Server-side direct calls and background tasks must keep working.

## Verification

After implementing:
1. Start Episteme with a fresh workspace — `GET /api/agent-mode` returns `{ activePlugins: [] }`
2. Open the diagram editor and trigger a diagram — `GET /api/agent-mode` now shows `{ activePlugins: ["Diagram"] }` and `/api/metrics` shows `registeredToolCount` increased by 1
3. Open the Conflicts panel and run a scan — `activePlugins` adds `"Contradiction"`
4. Check citations — `activePlugins` adds `"Citation"`
5. Save a style guide in Settings — `activePlugins` adds `"StyleGuide"`
6. Clicking Layers button activates all; clicking again deactivates all back to `[]`
7. `bun test packages/framework` — still only the 10 known pre-existing failures

## Files to touch

| File | Change |
|------|--------|
| `packages/app-episteme/src/agent.ts` | Refactor `ModeGated` to use `Set<string>`; update bundle interface |
| `packages/app-episteme/src/server/index.ts` | Call `bundle.activatePlugin()` at 4 trigger points; update `/api/agent-mode` response shape |
| `packages/app-episteme/src/App.tsx` | Update Layers button to reflect per-plugin state |
