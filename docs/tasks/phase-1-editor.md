# Phase 1 — Core Editor UI

## Status

- [x] Install TipTap + tiptap-markdown (@tiptap/react, @tiptap/starter-kit, tiptap-markdown, @tiptap/extension-placeholder, @tiptap/extension-character-count)
- [x] Create `src/apps/episteme/styles.css` — full dark-theme stylesheet
- [x] Build `src/apps/episteme/components/Editor.tsx` — TipTap editor with toolbar
- [x] Build `src/apps/episteme/components/FileTree.tsx` — workspace file browser
- [x] Build `src/apps/episteme/components/AISidecar.tsx` — AI chat panel
- [x] Rebuild `src/apps/episteme/App.tsx` — full 3-pane layout with WebSocket integration
- [x] Update `src/apps/episteme/server.ts` — add `list_workspace` / `workspace_files` messages
- [x] Update `src/apps/episteme/plugins/WorkspacePlugin.ts` — file indexing + FTS5 search
- [x] Update `src/apps/episteme/agent.ts` — pass memoryPlugin to WorkspacePlugin
- [x] Server-side verification complete (WebSocket, file ops, workspace listing)
- [ ] Manual browser verification (see "Verifiable" checklist below)

## Current State

All Phase 1 code written and server-side verified:
- WebSocket connects, `state_change` on open ✅
- `list_workspace` → `workspace_files: ["hello.md"]` ✅
- `file_open` → `file_content` with correct Markdown content ✅
- Browser UI (3-pane layout, TipTap editor) — **requires manual browser test**

## Last Known Good

Phase 1 server verification: WebSocket + file ops all working.
Phase 0 baseline: health endpoint 200, SQLite DB scoped to workspace.

## To Resume

1. Read this file
2. Run: `bun --hot episteme.ts ~/test-workspace`
3. Open `http://localhost:4000`
4. Work through the verifiable checklist below

## Verifiable Checklist

- [ ] Server starts without TypeScript errors
- [ ] Browser shows 3-pane layout (FileTree | Editor | AISidecar)
- [ ] File tree shows .md files from workspace after connecting
- [ ] Clicking a file opens it in the editor
- [ ] CMD+B toggles bold, CMD+I italic, headings via toolbar
- [ ] CMD+S saves the file (Save button disappears / shows "Saved")
- [ ] AI Sidecar: typing a message and pressing Enter sends it to the agent
- [ ] Agent responds in the sidecar panel
- [ ] AISidecar collapse/expand toggle works
- [ ] `index_workspace` tool works (agent can be asked "please index my workspace")

## Open Questions

- **TipTap 3.x setContent with Markdown**: The `editor.commands.setContent()` call with
  a Markdown string relies on `tiptap-markdown` patching the command. If loading a file
  produces garbled content, switch to `editor.commands.setMarkdown()` if the extension
  provides it, or reinitialize the editor instance on file change.

- **CharacterCount API**: In TipTap 3.x, `editor.storage.characterCount.words()` is
  the correct accessor. If it's undefined, the extension may not be installed or the
  storage key may differ — check `Object.keys(editor.storage)` in browser console.

- **WebSocket reconnect**: App.tsx reconnects on close with a 2s delay. This means
  opening the URL before the server is fully ready will auto-recover.

## Files Modified This Phase

```
src/apps/episteme/styles.css          (new)
src/apps/episteme/components/Editor.tsx     (new)
src/apps/episteme/components/FileTree.tsx   (new)
src/apps/episteme/components/AISidecar.tsx  (new)
src/apps/episteme/App.tsx             (rewritten)
src/apps/episteme/index.html          (simplified — CSS now in styles.css imported from App.tsx)
src/apps/episteme/server.ts           (updated — list_workspace, workspace_files, file_saved)
src/apps/episteme/plugins/WorkspacePlugin.ts  (full implementation)
src/apps/episteme/agent.ts            (pass memoryPlugin to WorkspacePlugin)
package.json                          (TipTap deps added)
docs/tasks/phase-1-editor.md          (new)
```
