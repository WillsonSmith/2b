# Phase 0 — Foundation & Architecture

## Status

- [x] Create `src/apps/episteme/paths.ts` — workspace path utilities
- [x] Create `src/apps/episteme/config.ts` — EpistemModelConfig loader/saver
- [x] Create `src/apps/episteme/plugins/EditorContextPlugin.ts` — skeleton
- [x] Create `src/apps/episteme/plugins/WorkspacePlugin.ts` — skeleton
- [x] Create `src/apps/episteme/agent.ts` — CortexAgent assembly
- [x] Create `src/apps/episteme/server.ts` — Bun.serve() with WebSocket
- [x] Create `src/apps/episteme/index.html` + `App.tsx` — Phase 0 scaffold UI
- [x] Create `episteme.ts` — CLI entry point
- [x] Create `PROJECT_PLAN.md` + `docs/tasks/phase-0-foundation.md`
- [x] Verify: `bun episteme.ts ~/test` starts, `/api/health` returns 200
- [x] Verify: `.episteme/agent.sqlite` is created in workspace
- [ ] Verify: chat works in browser at `http://localhost:4000` (manual browser test pending)

## Current State

All files created and server verified. `/api/health` returns 200, `.episteme/agent.sqlite`
is created on first run. Browser chat UI not yet manually tested (Phase 0 scaffold is a
minimal chat pane — full editor UI is Phase 1).

## Last Known Good

Phase 0 verification: `bun episteme.ts /tmp/episteme-test-workspace` → server at :4000,
health endpoint OK, SQLite DB created.

## To Resume

1. Read this file
2. Run `bun episteme.ts ~/test-workspace` — look for "Episteme running at http://localhost:4000"
3. Check that `~/test-workspace/.episteme/agent.sqlite` was created
4. `curl http://localhost:4000/api/health` should return `{"status":"ok","app":"episteme",...}`
5. Open browser at `http://localhost:4000` — Phase 0 chat scaffold should load
6. If any step fails, check the error and fix before moving to Phase 1

## Open Questions

- **Global memory plugin**: The plan calls for a second `CortexMemoryPlugin` pointing to
  `~/.config/episteme/global.sqlite`. Both instances would expose the same tool names
  (`search_memory`, `save_memory`, etc.), causing conflicts. Solution for Phase 1:
  create a `GlobalMemoryPlugin` wrapper that renames the tools with a `global_` prefix.
  
- **Permission manager**: Phase 0 uses `AutoApprovePermissionManager`. Phase 1 needs a
  `WebPermissionManager` that sends permission requests over the WebSocket channel.

- **TypeScript path aliases**: All imports use relative paths (`../../core/...`). If paths
  become unwieldy, add `tsconfig.json` path aliases for the episteme app.

## Files Created This Phase

```
episteme.ts
src/apps/episteme/paths.ts
src/apps/episteme/config.ts
src/apps/episteme/agent.ts
src/apps/episteme/server.ts
src/apps/episteme/index.html
src/apps/episteme/App.tsx
src/apps/episteme/plugins/EditorContextPlugin.ts
src/apps/episteme/plugins/WorkspacePlugin.ts
PROJECT_PLAN.md
docs/tasks/phase-0-foundation.md
```
