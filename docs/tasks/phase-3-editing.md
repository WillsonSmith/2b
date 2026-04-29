# Phase 3 — Editing & Refinement

## Status

- [ ] Implement `features/tone.ts` — tone transformation (Professional / Casual / Academic)
- [ ] Add selection context menu to `Editor.tsx` with tone options
- [ ] Implement `features/summarize.ts` — semantic summarization of selection or current section
- [ ] Add "Summarize Section" command to editor toolbar / context menu
- [ ] Implement `features/lint.ts` — AI linter (clarity, conciseness, fluff detection)
- [ ] Run linter automatically on `file_save`; return `{ range, suggestion, type }` array
- [ ] Render lint decorations as inline underlines in TipTap
- [ ] Build `StyleGuidePlugin.ts` — reads `.episteme/style-guide.md`, injects as system prompt fragment
- [ ] Add style guide upload UI to `SettingsPanel.tsx` (or a simple modal)
- [ ] Stub `fact_check(claim)` tool on `WorkspacePlugin` (searches workspace memory for contradictions; full implementation Phase 5)
- [ ] Update `docs/tasks/phase-3-editing.md` with results before ending session

## Current State

Phase 2 complete. Phase 3 not started.

## Last Known Good

[Update this when Phase 2 finishes — paste the last verified state here]

## To Resume

1. Read `PROJECT_PLAN.md` for architecture overview
2. Read `docs/tasks/phase-2-drafting.md` to confirm Phase 2 is fully done
3. Read this file for Phase 3 task state
4. Run `bun --hot episteme.ts ~/your-test-workspace`
5. Open `http://localhost:4000` — verify autocomplete and outline from Phase 2 still work
6. Continue with the first unchecked task above

## Implementation Notes

### Tone Transformation (`features/tone.ts`)
- Triggered on text selection — add a floating toolbar or context menu to `Editor.tsx`
- Get selected text: `editor.state.selection`, `editor.state.doc.textBetween(from, to)`
- Send `{ type: "tone_transform", text: selectedText, tone: "professional"|"casual"|"academic" }` to server
- Server calls `HeadlessAgent` with the `default` model; returns transformed text
- Client replaces selection: `editor.chain().focus().insertContentAt({ from, to }, result).run()`

### Semantic Summarization (`features/summarize.ts`)
- "Summarize Section" finds the nearest heading and collects text until the next heading
- Uses `HeadlessAgent` with a summary prompt; returns a `> [TL;DR]: ...` blockquote
- Inserts the blockquote immediately after the heading

### AI Linter (`features/lint.ts`)
- Triggered on every `file_saved` WebSocket message
- Sends full document to a `HeadlessAgent` using the `linting` model (fast model — runs on every save)
- Returns array: `[{ from: number, to: number, suggestion: string, type: "clarity"|"conciseness"|"fluff" }]`
- Client renders these as TipTap `Decoration` marks with colored underlines
- Clicking a decoration shows a tooltip with the suggestion
- **Performance note**: Run with timeout (max 8s); skip if previous lint is still running

### Style Guide Plugin (`plugins/StyleGuidePlugin.ts`)
- `onInit`: reads `.episteme/style-guide.md` if it exists; stores content
- `getSystemPromptFragment()`: injects the style guide text (only on linting calls, or always if small)
- Exposes tool `get_style_guide()` and `set_style_guide(content)` for the agent
- UI: simple "Upload Style Guide" button in settings that posts Markdown text to `PATCH /api/style-guide`

### Fact-Check Stub
- Add `fact_check(claim: string)` to `WorkspacePlugin.getTools()`
- Implementation: `queryMemoriesRaw({ contains: claim, types: ["factual"] })` and return matching memories
- Full contradiction detection is Phase 5

## Open Questions

- **Lint decoration persistence**: TipTap decorations are lost when the document is re-parsed. Store lint results in React state and re-apply via a `DecorationSet` plugin on each `EditorState` update.
- **Linting model**: If `linting` model is not configured in `.episteme/config.json`, fall back to `default`. Never block the save to wait for lint — lint is always async and non-blocking.
- **Context menu vs floating toolbar**: TipTap has a `BubbleMenu` extension for selection-based floating toolbars. Use this for tone/summarize rather than a right-click context menu for better UX.

## Files to Create/Modify This Phase

```
src/apps/episteme/features/tone.ts           (new)
src/apps/episteme/features/summarize.ts      (new)
src/apps/episteme/features/lint.ts           (new)
src/apps/episteme/plugins/StyleGuidePlugin.ts (new)
src/apps/episteme/components/Editor.tsx      (add BubbleMenu, lint decorations)
src/apps/episteme/components/SettingsPanel.tsx (new — style guide upload UI)
src/apps/episteme/App.tsx                    (wire lint results, settings panel toggle)
src/apps/episteme/server.ts                  (add tone_transform, summarize, lint, style-guide handlers)
src/apps/episteme/agent.ts                   (register StyleGuidePlugin)
src/apps/episteme/plugins/WorkspacePlugin.ts (add fact_check stub tool)
```
