# Episteme Desktop App — Packaging Plan

## Context

Episteme is an AI-powered markdown research editor. It currently runs as a Bun HTTP + WebSocket server with a React/TipTap frontend served over localhost. This plan converts it into a desktop app while preserving the ability to swap native shells (Electron → Tauri → native macOS) in future.

**Working directory for all paths:** `src/apps/episteme/`

---

## Architecture Decision

**Chosen approach: Bun-as-subprocess inside Electron**

Electron's main process spawns the existing `server.ts` as a child Bun process. A `BrowserWindow` loads `http://localhost:PORT`. Native OS integration (folder picker, menus, etc.) lives in the Electron main process and is bridged to the renderer via a preload script.

This means:
- `server.ts` and all Bun-specific APIs (`Bun.file`, `Bun.$`, `Bun.Glob`) are **unchanged**
- The Electron shell is thin — just a native wrapper
- The same server can be wrapped by Tauri or Swift later with zero backend changes
- The app remains usable as a plain browser app (`bun run server.ts ./workspace`)

---

## Shell Abstraction

Define a `IShell` interface that the frontend uses for all platform-specific operations. Electron, Tauri, and browser each implement it.

```
shell/
  IShell.ts          # Interface definition
  BrowserShell.ts    # Browser fallback (current behavior)
  ElectronShell.ts   # Electron renderer-side implementation
  index.ts           # Factory: detect environment, export the right shell
```

### `IShell` interface

```ts
export interface IShell {
  openFolder(): Promise<string | null>;         // native folder picker dialog
  getAppVersion(): Promise<string>;
  platform(): 'electron' | 'tauri' | 'browser';
  // Add more as needed: showNotification, openExternal, etc.
}
```

### Detection pattern

```ts
// shell/index.ts
export function getShell(): IShell {
  if (typeof window !== 'undefined' && (window as any).__electronShell) {
    return new ElectronShell();
  }
  return new BrowserShell();
}
```

---

## File Layout to Create

```
src/apps/episteme/
├── shell/
│   ├── IShell.ts
│   ├── BrowserShell.ts
│   ├── ElectronShell.ts
│   └── index.ts
└── electron/
    ├── main.ts              # Electron main process
    ├── preload.ts           # contextBridge exposure
    ├── package.json         # Electron entry + electron-builder config
    ├── tsconfig.json        # CommonJS target for main process
    └── icons/
        ├── icon.png         # 512x512 source icon
        ├── icon.icns        # macOS
        └── icon.ico         # Windows
```

---

## Step-by-Step Implementation

### Step 1 — Add `--port` and `--workspace` flags to `server.ts`

Currently `server.ts` reads workspace from `process.argv[2]` and uses a hardcoded port. Electron needs to control both.

**Changes to `server.ts`:**

```ts
// Parse CLI args with fallbacks
const args = process.argv.slice(2);
const workspaceArg = args.find(a => a.startsWith('--workspace='))?.slice(12) ?? args[0];
const portArg = parseInt(args.find(a => a.startsWith('--port='))?.slice(7) ?? '3737');
const PORT = portArg;
```

The `--port` flag lets Electron pick a free port. The existing positional `argv[2]` path continues to work so the CLI workflow is unchanged.

### Step 2 — Create the shell abstraction

**`shell/IShell.ts`**
```ts
export interface IShell {
  openFolder(): Promise<string | null>;
  getAppVersion(): Promise<string>;
  platform(): 'electron' | 'tauri' | 'browser';
}
```

**`shell/BrowserShell.ts`**
The browser cannot open a native folder picker. Return `null` from `openFolder()` — the frontend should fall back to a text-input prompt.

```ts
export class BrowserShell implements IShell {
  openFolder() { return Promise.resolve(null); }
  getAppVersion() { return Promise.resolve('dev'); }
  platform() { return 'browser' as const; }
}
```

**`shell/ElectronShell.ts`**
Calls the APIs exposed by the preload script.

```ts
export class ElectronShell implements IShell {
  openFolder() { return (window as any).__electronShell.openFolder(); }
  getAppVersion() { return (window as any).__electronShell.getAppVersion(); }
  platform() { return 'electron' as const; }
}
```

**`shell/index.ts`** — factory as shown above.

### Step 3 — Update `App.tsx` to use the shell for folder opening

Currently the workspace path is determined server-side (CLI arg). In the desktop app, the user picks a folder on first launch. The flow:

1. App loads → calls `GET /api/health`
2. If `health.workspace` is `null` (server started with no workspace arg), show a "Open folder" prompt
3. `openFolder()` returns a path → `POST /api/workspace` sets it at runtime
4. Workspace is persisted to `~/.config/episteme/last-workspace` for next launch

**New API endpoint to add to `server.ts`:**
```ts
// POST /api/workspace  { path: string }
// Sets workspace at runtime and reinitialises all plugins
```

**`App.tsx` changes:**
- Import `getShell` from `./shell/index`
- On mount, if `health.workspace` is absent, call `shell.openFolder()`
- Pass result to the new `/api/workspace` endpoint
- Show a proper "no workspace" empty state if both shell and API return null

### Step 4 — Create the Electron main process

**`electron/main.ts`**

Key responsibilities:
1. Find a free TCP port
2. Spawn `bun run src/apps/episteme/server.ts --port=PORT` as a child process
3. Wait for server to be ready (poll `GET /health` or wait for stdout signal)
4. Open `BrowserWindow` loading `http://localhost:PORT`
5. Register a native "File > Open Folder" menu item that forwards to the IPC handler
6. Clean up child process on app quit

```ts
import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import * as net from 'net';
import * as path from 'path';

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

async function findFreePort(start = 3737): Promise<number> { /* ... */ }

async function startServer(port: number, workspace?: string) {
  const args = [`src/apps/episteme/server.ts`, `--port=${port}`];
  if (workspace) args.push(`--workspace=${workspace}`);
  serverProcess = spawn('bun', ['run', ...args], {
    cwd: path.resolve(__dirname, '../../..'),  // repo root
    stdio: 'inherit',
  });
}

async function waitForServer(port: number, retries = 30): Promise<void> { /* poll /api/health */ }

app.whenReady().then(async () => {
  const port = await findFreePort();
  const lastWorkspace = readLastWorkspace();  // from ~/.config/episteme/last-workspace
  await startServer(port, lastWorkspace);
  await waitForServer(port);
  createWindow(port);
  buildMenu(port);
});

app.on('will-quit', () => serverProcess?.kill());
```

**Native menu:**
- `File > Open Folder` → `dialog.showOpenDialog({ properties: ['openDirectory'] })` → sends result to renderer via `mainWindow.webContents.send('workspace-selected', path)`
- `File > Open Recent` (optional, uses `app.addRecentDocument`)

**IPC handlers:**
```ts
ipcMain.handle('open-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-app-version', () => app.getVersion());
```

### Step 5 — Create the Electron preload script

**`electron/preload.ts`**
```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('__electronShell', {
  openFolder: () => ipcRenderer.invoke('open-folder'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
});
```

The preload script must be listed in `BrowserWindow` options:
```ts
new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
  },
});
```

### Step 6 — Configure `electron/package.json`

Separate `package.json` for the Electron shell only. The main `package.json` remains unchanged.

```json
{
  "name": "episteme",
  "version": "0.1.0",
  "main": "dist/main.js",
  "scripts": {
    "start": "electron .",
    "build": "tsc && electron-builder"
  },
  "devDependencies": {
    "electron": "^31.0.0",
    "electron-builder": "^24.0.0",
    "typescript": "^5.0.0"
  },
  "build": {
    "appId": "com.episteme.app",
    "productName": "Episteme",
    "directories": { "output": "dist-app" },
    "mac": {
      "target": [{ "target": "dmg", "arch": ["universal"] }],
      "icon": "icons/icon.icns",
      "category": "public.app-category.productivity"
    },
    "extraResources": [
      { "from": "../../..", "to": "app", "filter": ["src/**", "package.json", "bun.lockb"] }
    ],
    "files": ["dist/**"]
  }
}
```

### Step 7 — Bundle Bun with the app (for distribution)

When distributing, users won't have Bun installed. Options in order of preference:

**Option A (recommended for now): Bundle Bun binary**
- Download the Bun binary for the target platform during `electron-builder` `afterPack` hook
- Place at `resources/bin/bun`
- In `main.ts`, resolve Bun path as: `app.isPackaged ? path.join(process.resourcesPath, 'bin/bun') : 'bun'`

**Option B: Compile server to a standalone binary**
- `bun build --compile src/apps/episteme/server.ts --outfile resources/server`
- Electron main process spawns `resources/server --port=PORT`
- Removes Bun runtime dependency entirely
- Caveat: compiled Bun binaries don't support all dynamic requires; test carefully

**Option B is cleaner for distribution.** Use it unless dynamic plugin loading breaks.

### Step 8 — Handle external tool dependencies

The app shells out to `pandoc`, `ffmpeg`, and `whisper`. In the packaged app:

1. **Detection:** `paths.ts` already uses `which pandoc` to detect availability and disables export gracefully — no change needed.
2. **User guidance:** Add an "About" or "Requirements" screen listing optional tools and their install commands (`brew install pandoc`, etc.)
3. **Future:** Bundle `pandoc` as an `extraResource` for a fully self-contained app.

### Step 9 — `electron/tsconfig.json`

The main process must target CommonJS (Electron's Node.js context):

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true
  },
  "include": ["main.ts", "preload.ts"]
}
```

### Step 10 — Test checklist

Before declaring the Electron build done:

- [ ] `bun run server.ts --workspace=./test-workspace --port=3738` starts cleanly
- [ ] `electron .` (from `electron/`) launches and shows the UI
- [ ] "Open Folder" menu item opens native dialog and sets workspace
- [ ] Files open, save, rename correctly
- [ ] WebSocket chat with agent works
- [ ] Export (PDF/HTML) works when Pandoc is installed
- [ ] App quits cleanly (server subprocess exits)
- [ ] `electron-builder --mac` produces a `.dmg`
- [ ] Packaged `.dmg` install and launch on a machine without Bun (using compiled server binary)

---

## Future: Adding Tauri Support

Because the backend is a standalone Bun/HTTP process, adding Tauri is straightforward:

1. Create `shell/TauriShell.ts` — calls `@tauri-apps/api` for folder picker
2. Create `tauri/` directory with `tauri.conf.json` and Rust shell commands
3. In `tauri/src-tauri/main.rs`: spawn the compiled Bun server binary on startup
4. Update `shell/index.ts` factory to detect `window.__TAURI__`

No backend changes required.

---

## Future: Adding Native macOS Support

A Swift/SwiftUI wrapper follows the same pattern:
1. Implement `IShell` via a `WKWebView` + native Swift message handlers
2. Inject `window.__nativeShell` via `WKUserContentController`
3. Spawn the compiled Bun server binary from Swift on launch

---

## Implementation Order

1. `server.ts` — add `--port` / `--workspace` flags (15 min)
2. `shell/` — IShell + BrowserShell + ElectronShell + index (30 min)
3. `App.tsx` — integrate shell for folder picking, add workspace empty state (45 min)
4. `server.ts` — add `POST /api/workspace` runtime workspace setter (30 min)
5. `electron/main.ts` + `electron/preload.ts` (1.5 hr)
6. `electron/package.json` + `electron/tsconfig.json` (15 min)
7. Bundling strategy: test Option B (compiled binary) (1 hr)
8. App icon creation (30 min)
9. Test checklist above (1 hr)

**Total estimate: ~6 hours of focused work**
