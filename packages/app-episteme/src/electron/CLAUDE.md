# Electron Shell (`@2b/electron-shell`)

Thin Electron wrapper for the Episteme desktop app. All AI and file logic lives in the Bun server (`packages/app-episteme/episteme.ts` + `packages/app-episteme/src/`). This directory is solely responsible for native OS integration.

## Files

| File | Purpose |
|------|---------|
| `main.ts` | Electron main process — spawns the Bun server, manages the BrowserWindow, native menus, IPC handlers |
| `preload.ts` | Runs in the renderer sandbox — exposes `window.__electronShell` via `contextBridge` |
| `tsconfig.json` | CommonJS target required by Electron's Node.js context |
| `package.json` | Electron entry point (`@2b/electron-shell`) + `electron-builder` distribution config |
| `scripts/afterPack.js` | `electron-builder` hook — downloads the Bun binary into `Contents/Resources/bin/` at build time |

## Architecture

```
Electron main process (main.ts)
  └─ spawns: bun packages/app-episteme/episteme.ts --port=PORT [--workspace=PATH]
              ↑
              Bun HTTP + WebSocket server (unchanged from browser mode)
              ↑
  BrowserWindow loads http://localhost:PORT
              ↑
  preload.ts injects window.__electronShell
              ↑
  shell/ElectronShell.ts calls IPC via __electronShell
```

The server and frontend are identical whether opened in a browser or Electron. Electron adds only: native folder picker, native menus, and lifecycle management.

## IPC Surface (`preload.ts` ↔ `main.ts`)

| Channel | Direction | Handler |
|---------|-----------|---------|
| `open-folder` | renderer → main | `dialog.showOpenDialog` — returns selected path or `null` |
| `get-app-version` | renderer → main | `app.getVersion()` |

Both are `ipcMain.handle` / `ipcRenderer.invoke` (promise-based). Add new channels here when native OS capabilities are needed; keep business logic out of IPC handlers.

## Workspace Lifecycle

1. App starts → reads `~/.config/episteme/last-workspace`
2. If found, server starts with `--workspace=PATH`
3. If not found, server starts in stub mode (no agent, just serves the UI)
4. UI shows "Open Folder" prompt → calls `shell.openFolder()` → IPC `open-folder`
5. Frontend POSTs selected path to `POST /api/workspace`
6. Stub server saves path to `~/.config/episteme/last-workspace` and exits(0)
7. Main process catches exit(0), restarts server with workspace, reloads BrowserWindow
8. "File > Open Folder…" menu item (`⌘⇧O`) triggers `restartWithWorkspace()` directly

## Running in Development

From the repo root:
```sh
bun run electron
```

This runs `npm --prefix packages/app-episteme/src/electron start`, which compiles `main.ts` and `preload.ts` to `dist/` (CommonJS) and launches `electron .`.

The Bun server is spawned from `repoRoot()` in `main.ts`, which resolves 5 `..` from `dist/` to the monorepo root. It then runs:
```
bun packages/app-episteme/episteme.ts --port=PORT [--workspace=PATH]
```

## Building for Distribution

From the electron directory (`packages/app-episteme/src/electron/`):
```sh
npm run build:mac   # produces dist-app/*.dmg (universal)
npm run build       # all platforms
```

`electron-builder` runs `scripts/afterPack.js` automatically after packing. That script downloads the Bun binary for the target platform from GitHub releases and places it at `Contents/Resources/bin/bun`. In the packaged app, `bunBin()` in `main.ts` resolves to that path instead of the system `bun`.

The monorepo source (`packages/**`, `package.json`, `bun.lock`) is copied into `Contents/Resources/app/` via `extraResources` in `package.json`.

## Adding Native Features

1. Add an `ipcMain.handle('channel-name', ...)` handler in `main.ts`
2. Expose it in `preload.ts` via `contextBridge.exposeInMainWorld('__electronShell', { ... })`
3. Add the method signature to `packages/app-episteme/src/shell/IShell.ts`
4. Implement it in `packages/app-episteme/src/shell/ElectronShell.ts` (calls `window.__electronShell.channelName()`)
5. Add a no-op fallback in `packages/app-episteme/src/shell/BrowserShell.ts`

## Key Constraints

- `main.ts` and `preload.ts` compile to **CommonJS** (`"module": "CommonJS"` in `tsconfig.json`) — Electron's Node.js context does not support ESM.
- `contextIsolation: true` and `nodeIntegration: false` are required for security. Never disable them.
- The preload only exposes what's needed — don't widen the `__electronShell` surface without a concrete use case.
- The Bun server port is dynamic (`findFreePort` starting at 4000) so multiple Episteme instances can coexist.
- This package is a Bun workspace member (`@2b/electron-shell`) but uses its own `node_modules/` and `npm` for its dependencies — Bun does not manage `electron` or `electron-builder`.
