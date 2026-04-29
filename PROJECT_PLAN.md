# Project Episteme — Master Development Plan

> **AI-Powered Markdown Editor and Research Workstation**
> Built on top of the 2b agent framework.

See [`/Users/willsonsmith/.claude/plans/mission-directive-project-episteme-piped-crescent.md`](../.claude/plans/mission-directive-project-episteme-piped-crescent.md) for the full architectural plan.

---

## Quick Reference

| Entry point | `bun episteme.ts <workspace-path>` |
|---|---|
| Default port | 4000 |
| Workspace DB | `{workspace}/.episteme/agent.sqlite` |
| Config | `{workspace}/.episteme/config.json` |

---

## Phase Status

| Phase | Name | Status |
|---|---|---|
| 0 | Foundation & Architecture | ✅ Complete — server boots, DB scoped to workspace |
| 1 | Core Editor UI | ✅ Complete — TipTap editor, FileTree, AISidecar, WorkspacePlugin |
| 2 | Drafting & Ideation | ⬜ Not started |
| 3 | Editing & Refinement | ⬜ Not started |
| 4 | Structural Intelligence | ⬜ Not started |
| 5 | Research Workstation | ⬜ Not started |
| 6 | Workflow & Ecosystem | ⬜ Not started |

---

## Application Structure

```
episteme.ts                           ← CLI entry point
src/apps/episteme/
  paths.ts                            ← workspace/global path utilities
  config.ts                           ← EpistemeConfig (per-feature model mapping)
  agent.ts                            ← CortexAgent assembly
  server.ts                           ← Bun.serve() HTTP + WebSocket
  index.html                          ← editor HTML entry point
  App.tsx                             ← React root (Phase 0: chat scaffold)
  plugins/
    EditorContextPlugin.ts            ← injects current doc into agent context
    WorkspacePlugin.ts                ← workspace file tools
  [future phases add more here]
docs/tasks/
  phase-0-foundation.md
  phase-1-editor.md
  ...
```

---

## To Start a New Session

1. Read `docs/tasks/phase-N-*.md` for the current phase
2. Run `bun episteme.ts ~/test-workspace` to verify current state
3. Continue with the first unchecked task in the phase doc

---

## Key Dependencies (install before Phase 1)

```bash
bun add @tiptap/react @tiptap/starter-kit @tiptap/extension-markdown
bun add @tiptap/extension-placeholder @tiptap/extension-character-count
bun add mermaid pdfjs-dist
bun add d3-force react-force-graph
```
