# Plan A — File Tree CRUD & State

## Goal

Improve `FileTree.tsx` in three ways:

1. **Delete file** — right-click context menu entry with a confirmation dialog.
2. **Persist folder expansion state to the workspace DB** — currently in `localStorage`, which is browser-scoped and lost in Electron rebuilds / across machines. Move it to the workspace SQLite file so it travels with the workspace.
3. **Reveal-in-tree on file open** — when a file is opened (e.g. from `UnifiedSearch`), automatically expand ancestor folders and scroll the entry into view.

## Dependencies

None — independent. Can ship first.

## Context

- Source: `docs/Findings/misc_shortcomings.md` ("File Tree & Navigation" section).
- Episteme is a Bun + React app. The frontend talks to the server over a WebSocket (`useFileManager.ts`, see `packages/app-episteme/src/hooks/useFileManager.ts`). File mutations are message-based (`file_create`, `file_rename`, `folder_create`, `folder_rename`).
- The server-side file-op handlers live in `packages/app-episteme/src/server/handlers/file.ts`. The dispatch table is in `packages/app-episteme/src/server/index.ts` around lines 160–170.
- The file tree component is `packages/app-episteme/src/components/FileTree.tsx`. Expansion state today reads/writes `localStorage` (see `expandedDirs` `useState` initializer around lines 158–177 and `persistExpanded` around 179).
- The workspace DB has a `ws_meta` key/value table already (`packages/app-episteme/src/db/workspaceDb.ts`, see `getMeta`/`setMeta` around lines 700–707). That's the right home for expansion state.

## Implementation steps

### 1. Delete file — server-side handler

In `packages/app-episteme/src/server/handlers/file.ts`:

- Add a new case `"file_delete"` to the switch. Mirror the structure of `"file_rename"` (around lines 209–229).
- Resolve the workspace-relative path via `resolveWorkspacePath`. If it escapes, send the standard `{ type: "error", message: "Path escapes workspace boundary." }`.
- Use `Bun.file(absolute).unlink()` (or `await unlink(absolute)` from `node:fs/promises` if `Bun.file` lacks unlink in this version — match what the file already imports).
- After successful delete, broadcast workspace files via the existing `sendWorkspaceFiles()` call, and send `{ type: "file_deleted", path: relPath }` to the originating socket so the client can clear active-file state if needed.
- Also clean up DB rows: call `workspaceDb.deleteWorkspaceFile(relPath)` (already exists at `workspaceDb.ts:593`). Outbound links auto-cascade via the `ws_file_links` FK.

Add the new message type to the type union in `file.ts` line 76 (extend the inline message-type union with `"file_delete"`).

In `packages/app-episteme/src/server/index.ts`, add `case "file_delete":` to the dispatch around lines 165–170 alongside `file_create`/`file_rename`.

### 2. Delete file — protocol + client wiring

In `packages/app-episteme/src/protocol.ts`, add the request and response shapes alongside the existing file message types:

```ts
| { type: "file_delete"; path: string }
| { type: "file_deleted"; path: string }
```

(Match the casing/style already present in this file — `oldPath`/`newPath` etc.)

In `packages/app-episteme/src/hooks/useFileManager.ts`:

- Add `deleteFile = useCallback((path: string) => wsRef.current?.send(JSON.stringify({ type: "file_delete", path })), [wsRef]);` next to `renameFile` (around line 107).
- Subscribe to `file_deleted`: if `activeFileRef.current === msg.path`, clear `activeFile`, `editorContent`, `savedContent`, and `isDirty`. Add the unsubscribe to the return-cleanup. Mirror the pattern around lines 147–177.
- Export `deleteFile` in the returned object (around line 224).

### 3. Delete file — FileTree UI

In `packages/app-episteme/src/components/FileTree.tsx`:

- Add `onDeleteFile: (path: string) => void` to `FileTreeProps`.
- In the `file` branch of the context menu (around line 587), add a "Delete" button (place it after "Rename", separated by a `file-tree-context-separator`). The handler should:
  - Close the menu.
  - Open a confirmation dialog. Use a small inline modal — there isn't a generic confirm-dialog component, so add one inline (component-local React state `pendingDelete: string | null`, render a fixed-position overlay with backdrop + "Delete <basename>?" + Cancel/Delete buttons). Style it consistent with the existing context menu (`file-tree-context-menu` CSS class for reference).
  - On confirm, call `onDeleteFile(path)` and clear `pendingDelete`.
- Wire `onDeleteFile={deleteFile}` from `App.tsx` where `<FileTree ... />` is rendered (search `App.tsx` for `<FileTree` to find the call site).

**Important:** do not allow deleting via background or directory context menu (only file). Folder delete is out of scope for this plan.

### 4. Persist folder expansion state to workspace DB

Goal: replace the `localStorage`-backed `expandedDirs` in `FileTree.tsx` with a workspace-DB-backed value.

**Server side** — add two WebSocket messages in `packages/app-episteme/src/server/handlers/file.ts` (or a new handler file if cleaner — but file.ts is fine; it owns workspace state):

- `"get_filetree_expanded"` → server reads `workspaceDb.getMeta("filetree.expanded")`, parses as a JSON string array, replies `{ type: "filetree_expanded", paths: string[] }`.
- `"set_filetree_expanded"` with `{ paths: string[] }` → server writes `workspaceDb.setMeta("filetree.expanded", JSON.stringify(paths))`. No reply needed.

Wire both into the dispatch in `server/index.ts`.

Add the message types to `protocol.ts`.

**Client side** — in `FileTree.tsx`:

- Remove the `localStorage` reads/writes (`expandedDirs` initial state, the `useEffect` that re-initializes on `workspaceRoot`, and `persistExpanded`).
- Accept a new prop `initialExpandedDirs: string[]` and `onExpandedChange: (paths: string[]) => void`.
- Initialize `expandedDirs` from `initialExpandedDirs`. Call `onExpandedChange([...next])` inside `toggleDir` and `expandDir`.

In `useFileManager.ts` (or a small new hook `useFileTreeState.ts` in `packages/app-episteme/src/hooks/`):

- On WebSocket connect, send `{ type: "get_filetree_expanded" }`.
- Subscribe to `"filetree_expanded"`, store `expandedDirs` in state.
- Expose `setExpandedDirs(paths)` that sends `{ type: "set_filetree_expanded", paths }` and updates local state optimistically. Debounce sends (200 ms) — the user can toggle rapidly.

Pass `initialExpandedDirs` and `onExpandedChange` down through `App.tsx` to `<FileTree>`.

**Migration**: on first load after this lands, if `getMeta("filetree.expanded")` is null but `localStorage.getItem("episteme:filetree:expanded:<workspaceRoot>")` exists in the browser, copy it over once. Add this as a `useEffect` in the new hook — it's a small one-time migration.

### 5. Reveal-in-tree on file open

In `App.tsx`, find where files are opened from `UnifiedSearch` (look for the `onSelect` handler passed to `<UnifiedSearch>` around line 808; it eventually calls something like `setActiveFile` or sends a `file_open` WS message).

When a file is opened *not via a click in the tree itself* (i.e., from search, from a link click, from the AI sidecar, etc.), we need to:

1. Expand every ancestor directory of the file path.
2. Scroll that file's row into view in the tree.

Approach:

- Track the "last opened file" in `App.tsx`. When it changes, expand ancestors via the same DB-backed setter from step 4.
- In `FileTree.tsx`, add an effect that, when `activeFile` changes, finds the corresponding DOM row by `data-path` attribute (add this to each `file-tree-item` rendered) and calls `scrollIntoView({ block: "nearest" })`.

Skip the expand step if the click that opened the file originated *inside* the tree (the user already chose to expand it themselves). One way: have `FileTree.tsx`'s `onFileSelect` accept a flag `{ fromTree: true }`, or just always run the expand step idempotently — expanding an already-expanded folder is a no-op, so this is fine.

## Acceptance criteria

- Right-clicking a file in the tree shows a "Delete" item. Clicking it opens a confirmation; confirming removes the file from disk, from the DB, and from the tree.
- Folder open/closed state survives an app restart (verified by quitting and reopening the Electron app, or restarting `bun run episteme`).
- Opening a file from `UnifiedSearch` (cmd+K today; cmd+P after Plan B lands) auto-expands its parent folders and scrolls the row into view.
- The `localStorage` key `episteme:filetree:expanded:<workspaceRoot>` is no longer written. A one-time migration copies any existing value into the DB.
- `bun test` passes. No new lint errors.

## Verification

```bash
bun run episteme            # launch server + frontend
bun run electron            # or the desktop app
```

Manually:

1. Open a workspace with at least one nested folder.
2. Right-click a file → Delete → confirm. File should disappear from tree and disk.
3. Expand a few folders, restart the app, confirm they're still expanded.
4. Open `UnifiedSearch` (⌘K today), pick a file in a nested folder, confirm the tree reveals it.

Run `bun test` from repo root to catch regressions in `workspaceDb.test.ts`.

## Non-goals

- Folder delete (different blast radius — handle in a follow-up if needed).
- Multi-select delete.
- Trash/undo. Hard delete only; the user has git.
