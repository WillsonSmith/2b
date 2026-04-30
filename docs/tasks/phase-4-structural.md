# Phase 4 — Structural Intelligence

## Status

- [x] Implement `features/metadata.ts` — YAML frontmatter generation
- [x] Add "Generate Frontmatter" command to editor toolbar
- [x] Implement `features/toc.ts` — narrative TOC (each heading + 1-sentence description)
- [x] Render narrative TOC in a sidebar outline panel (`components/OutlinePanel.tsx`)
- [x] Implement `features/autolink.ts` — wikilink detection and suggestion
- [x] Show wikilink suggestions as inline prompts after file save (confirm each individually)
- [x] Create `DiagramPlugin.ts` — natural language → Mermaid.js code block
- [x] Add `/diagram:` slash command parsing to `Editor.tsx`
- [x] Render Mermaid diagrams in preview mode within the editor
- [x] Add `generate_table(description)` HeadlessAgent stub (convert selection or description to MD table)
- [x] Update `docs/tasks/phase-4-structural.md` with results before ending session

## Current State

Phase 4 complete. All structural intelligence features implemented.

## Last Known Good

Phase 4 complete. Server boots. All new WebSocket handlers wired. TypeScript clean (no new errors vs. Phase 3 baseline).

## Files Created/Modified

```
src/apps/episteme/features/metadata.ts       (new) — YAML frontmatter via HeadlessAgent
src/apps/episteme/features/toc.ts            (new) — Narrative TOC via HeadlessAgent
src/apps/episteme/features/autolink.ts       (new) — Wikilink candidate detection (pure)
src/apps/episteme/features/table.ts          (new) — Markdown table generation via HeadlessAgent
src/apps/episteme/plugins/DiagramPlugin.ts   (new) — Mermaid generator as AgentPlugin + standalone
src/apps/episteme/components/OutlinePanel.tsx (new) — Sidebar TOC with heading click nav
src/apps/episteme/components/FileTree.tsx    (modified) — Files/Outline tab bar
src/apps/episteme/components/Editor.tsx      (modified) — /diagram: slash command, Preview toggle, Frontmatter + Table buttons
src/apps/episteme/server.ts                  (modified) — 5 new WebSocket handlers
src/apps/episteme/App.tsx                    (modified) — Full Phase 4 state wiring + AutolinkBanner UI
src/apps/episteme/agent.ts                   (modified) — DiagramPlugin registered
src/apps/episteme/styles.css                 (modified) — tabs, outline panel, autolink banner, mermaid, preview
package.json                                 (modified) — mermaid@11.14.0 added
```

## Implementation Notes

### Auto-Metadata (`features/metadata.ts`)
- `generateFrontmatter(title, preview, config)` calls HeadlessAgent; returns raw YAML lines
- `parseFrontmatter(markdown)` / `injectFrontmatter(markdown, yaml)` utility functions
- Editor detects existing `---...---` block and replaces it rather than duplicating
- Toolbar button "⊞ Frontmatter" triggers `metadata_request` WebSocket message

### Narrative TOC (`features/toc.ts`)
- `extractSectionsFromMarkdown(markdown)` parses headings + following text from raw Markdown
- `generateNarrativeToc(sections, config)` sends all sections in one batch LLM call (JSON array)
- `OutlinePanel.tsx` shows H1/H2/H3 hierarchy with descriptions; click scrolls editor to heading
- Triggered by clicking ↺ in the Outline tab of the left sidebar

### Auto-Linking (`features/autolink.ts`)
- Pure function `detectAutolinkCandidates(markdown, workspaceFiles)` — no LLM
- Strips fenced code blocks before scanning; skips already-`[[wikilinked]]` text
- Server runs it automatically on every `file_save`; also available via `autolink_request`
- `AutolinkBanner` in App.tsx shows one suggestion at a time with Accept / Skip / Dismiss all

### Diagram Plugin (`plugins/DiagramPlugin.ts`)
- Implements `AgentPlugin` so agent can call `generate_diagram` tool from sidecar
- Also used directly by `server.ts` `DiagramPlugin.generate()` for the `/diagram:` slash command
- Client-side: typing `/diagram: <description>` and pressing Enter fires `diagram_request`
- Result replaces the `/diagram:` line with a `\`\`\`mermaid` code block
- Preview mode: toolbar "Preview" toggle dynamically imports `mermaid` and renders SVGs

### Intelligent Tables (`features/table.ts`)
- `generateTable(input, config)` accepts either a description or a selected bullet list
- Exposed via BubbleMenu "Table" button on text selection

## To Resume (Phase 5)

1. Read `PROJECT_PLAN.md` for architecture overview
2. Read this file to confirm Phase 4 is complete
3. Read `docs/tasks/phase-5-research.md` for Phase 5 tasks
4. Run `bun --hot episteme.ts ~/your-test-workspace`
5. Verify all Phase 4 features work before starting Phase 5
