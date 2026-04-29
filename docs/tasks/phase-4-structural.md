# Phase 4 — Structural Intelligence

## Status

- [ ] Implement `features/metadata.ts` — YAML frontmatter generation
- [ ] Add "Generate Frontmatter" command to editor toolbar
- [ ] Implement `features/toc.ts` — narrative TOC (each heading + 1-sentence description)
- [ ] Render narrative TOC in a sidebar outline panel (`components/OutlinePanel.tsx`)
- [ ] Implement `features/autolink.ts` — wikilink detection and suggestion
- [ ] Show wikilink suggestions as inline prompts after file save (confirm each individually)
- [ ] Create `DiagramPlugin.ts` — natural language → Mermaid.js code block
- [ ] Add `/diagram:` slash command parsing to `Editor.tsx`
- [ ] Render Mermaid diagrams in preview mode within the editor
- [ ] Add `generate_table(description)` HeadlessAgent stub (convert selection or description to MD table)
- [ ] Update `docs/tasks/phase-4-structural.md` with results before ending session

## Current State

Phase 3 complete. Phase 4 not started.

## Last Known Good

[Update this when Phase 3 finishes — paste the last verified state here]

## To Resume

1. Read `PROJECT_PLAN.md` for architecture overview
2. Read `docs/tasks/phase-3-editing.md` to confirm Phase 3 is fully done
3. Read this file for Phase 4 task state
4. Run `bun --hot episteme.ts ~/your-test-workspace`
5. Open `http://localhost:4000` — verify linting and tone transform from Phase 3 still work
6. Continue with the first unchecked task above

## Implementation Notes

### Auto-Metadata (`features/metadata.ts`)
- "Generate Frontmatter" sends the document title + first 500 chars to HeadlessAgent
- Returns YAML: `title`, `tags` (array), `date` (today's ISO date), `summary` (1 sentence)
- If frontmatter already exists, parse it with a YAML library and merge (don't overwrite user fields)
- Insert/replace at top of document: detect `---\n...\n---` block at position 0
- Bun has no built-in YAML — use a lightweight parser or regex for this simple case

### Narrative TOC (`features/toc.ts`)
- Parse headings from `editor.getJSON()` — walk nodes looking for `type: "heading"`
- For each heading, extract the text of nodes immediately following it (up to next heading)
- HeadlessAgent generates a 1-sentence description per section
- `OutlinePanel.tsx`: sidebar panel listing `H1 > H2 > H3` with descriptions; clicking scrolls editor
- Show the outline panel in a tab alongside the FileTree, or as a separate collapsible panel

### Auto-Linking (`features/autolink.ts`)
- On save, scan document for noun phrases that match existing workspace file names (from `WorkspacePlugin.fileIndex`)
- Also check memory tags from `CortexMemoryPlugin.queryMemoriesRaw({ types: ["factual"] })`
- For each match not already a `[[wikilink]]`, suggest it — show as a dismissible inline badge
- Accept: replaces the text with `[[filename]]`; Dismiss: adds to a per-file ignore list in `.episteme/autolink-ignore.json`
- **Don't auto-apply**: always require confirmation

### Diagram Plugin (`plugins/DiagramPlugin.ts`)
- Detects `/diagram: <description>` typed in editor (via TipTap input rule)
- Sends description to HeadlessAgent with system prompt: "Convert this description into a Mermaid.js diagram. Return only the Mermaid code block."
- Replaces the `/diagram:` line with a fenced `\`\`\`mermaid` code block
- Client-side rendering: import `mermaid` (`bun add mermaid`) and render `.language-mermaid` code blocks as SVG in preview mode
- **Two modes**: edit (shows raw code block) and preview (renders SVG)

### Intelligent Tables
- Selection-based: select a bullet list → "Convert to Table" command → HeadlessAgent maps items to columns
- Description-based: `generate_table("monthly sales by region")` → HeadlessAgent generates header + sample rows
- Insert result at cursor as a Markdown table

## Open Questions

- **Mermaid rendering**: `mermaid` package is client-side only. Import dynamically in browser context. In Bun's bundler, ensure `mermaid` is excluded from server-side code (it references `document`).
- **YAML frontmatter in TipTap**: TipTap's Markdown extension may strip YAML frontmatter since it's not standard Markdown. Options: (a) handle frontmatter as a special node type, (b) inject/strip it outside the editor (pre-process on load, post-process on save).
- **OutlinePanel placement**: Adding a third sidebar tab (Files | Outline) keeps the layout clean. Consider a tab-bar on the left panel with icons for each view.

## Files to Create/Modify This Phase

```
src/apps/episteme/features/metadata.ts       (new)
src/apps/episteme/features/toc.ts            (new)
src/apps/episteme/features/autolink.ts       (new)
src/apps/episteme/plugins/DiagramPlugin.ts   (new)
src/apps/episteme/components/OutlinePanel.tsx (new)
src/apps/episteme/components/Editor.tsx      (add slash command input rule, mermaid preview)
src/apps/episteme/components/FileTree.tsx    (add tab bar: Files | Outline)
src/apps/episteme/App.tsx                    (wire outline panel, autolink suggestions)
src/apps/episteme/server.ts                  (add metadata, toc, autolink, diagram handlers)
src/apps/episteme/agent.ts                   (register DiagramPlugin)
package.json                                 (add mermaid)
```
