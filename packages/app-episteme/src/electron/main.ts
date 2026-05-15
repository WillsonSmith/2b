import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from "electron";
import { spawn, type ChildProcess } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "episteme");
const LAST_WORKSPACE_FILE = path.join(CONFIG_DIR, "last-workspace");
const RECENT_WORKSPACES_FILE = path.join(CONFIG_DIR, "recent-workspaces.json");
const MAX_RECENT = 10;

interface WindowState {
  process: ChildProcess;
  port: number;
  workspace: string | undefined;
}

const windows = new Map<BrowserWindow, WindowState>();

// --- Workspace persistence ---

function readLastWorkspace(): string | undefined {
  try {
    return fs.readFileSync(LAST_WORKSPACE_FILE, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function saveLastWorkspace(workspacePath: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(LAST_WORKSPACE_FILE, workspacePath, "utf8");
}

function readRecentWorkspaces(): string[] {
  try {
    const data = fs.readFileSync(RECENT_WORKSPACES_FILE, "utf8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function addRecentWorkspace(workspacePath: string): void {
  const recents = readRecentWorkspaces().filter((p) => p !== workspacePath);
  recents.unshift(workspacePath);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(
    RECENT_WORKSPACES_FILE,
    JSON.stringify(recents.slice(0, MAX_RECENT)),
    "utf8",
  );
}

// --- Utilities ---

function repoRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app");
  }
  // electron/ is at packages/app-episteme/src/electron/ — repo root is 5 levels up from dist/
  return path.resolve(__dirname, "..", "..", "..", "..", "..");
}

function bunBin(): string {
  if (app.isPackaged) {
    const ext = process.platform === "win32" ? ".exe" : "";
    return path.join(process.resourcesPath, "bin", `bun${ext}`);
  }
  return "bun";
}

// --- Server ---

function startServer(workspace?: string): Promise<{ proc: ChildProcess; port: number }> {
  return new Promise((resolve, reject) => {
    const args = [
      path.join("packages", "app-episteme", "episteme.ts"),
      "--port=0", // let the OS assign a guaranteed-free port
    ];
    if (workspace) args.push(`--workspace=${workspace}`);

    const proc = spawn(bunBin(), args, {
      cwd: repoRoot(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      process.stdout.write(text);
      const match = text.match(/Episteme running at http:\/\/localhost:(\d+)/);
      if (match) resolve({ proc, port: Number(match[1]) });
    });

    proc.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data);
    });

    proc.on("error", reject);

    setTimeout(() => reject(new Error("Server failed to start within 10s")), 10_000);
  });
}

async function waitForServer(port: number, retries = 30): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server on port ${port} did not become ready`);
}

// --- Window factory ---

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on("closed", () => {
    const state = windows.get(win);
    state?.process?.kill();
    windows.delete(win);
    buildMenu();
  });

  win.webContents.on('will-navigate', (event, url) => {
    let requestedHost = new URL(url).host;
    let currentHost = new URL(win.webContents.getURL()).host;
    if (requestedHost !== currentHost) {
      event.preventDefault();
      shell.openExternal(url)
    }
  });

  return win;
}

// --- Project window lifecycle ---

async function openProjectWindow(
  workspace?: string,
  targetWindow?: BrowserWindow,
): Promise<BrowserWindow> {
  const { proc, port } = await startServer(workspace);
  await waitForServer(port);

  let win: BrowserWindow;
  if (targetWindow && !targetWindow.isDestroyed()) {
    // Reuse an existing window: kill its previous server first
    const oldState = windows.get(targetWindow);
    if (oldState) {
      oldState.process.kill();
      await new Promise((r) => setTimeout(r, 300));
    }
    win = targetWindow;
  } else {
    win = createWindow();
  }

  windows.set(win, { process: proc, port, workspace });
  win.loadURL(`http://localhost:${port}`);

  const title = workspace ? `${path.basename(workspace)} — Episteme` : "Episteme";
  win.setTitle(title);
  win.webContents.once("did-finish-load", () => win.setTitle(title));

  buildMenu();

  // Stub server (no workspace): exits with code 0 after the user picks a
  // workspace via the web UI. Reload that same window with the real server.
  proc.once("exit", async (code) => {
    if (code === 0 && !win.isDestroyed()) {
      const ws = readLastWorkspace();
      try {
        await openProjectWindow(ws, win);
      } catch (err) {
        console.error("Failed to restart server after workspace selection:", err);
      }
    }
  });

  return win;
}

// --- Menu ---

function buildMenu(): void {
  const recents = readRecentWorkspaces();

  const openRecentSubmenu: Electron.MenuItemConstructorOptions[] =
    recents.length > 0
      ? [
          ...recents.map((p) => ({
            label: path.basename(p),
            sublabel: p,
            click: async () => {
              addRecentWorkspace(p);
              buildMenu();
              try {
                await openProjectWindow(p);
              } catch (err) {
                console.error("Failed to open recent project:", err);
                dialog.showErrorBox("Failed to open project", String(err));
              }
            },
          })),
          { type: "separator" as const },
          {
            label: "Clear Recents",
            click: () => {
              fs.writeFileSync(RECENT_WORKSPACES_FILE, "[]", "utf8");
              buildMenu();
            },
          },
        ]
      : [{ label: "No Recent Projects", enabled: false }];

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Episteme",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Project…",
          accelerator: "CmdOrCtrl+Shift+N",
          click: async () => {
            const focused = BrowserWindow.getFocusedWindow();
            const opts = {
              title: "Create New Project",
              buttonLabel: "Create",
              nameFieldLabel: "Project name:",
              showsTagField: false,
            };
            const result = focused
              ? await dialog.showSaveDialog(focused, opts)
              : await dialog.showSaveDialog(opts);
            if (!result.canceled && result.filePath) {
              fs.mkdirSync(result.filePath, { recursive: true });
              saveLastWorkspace(result.filePath);
              addRecentWorkspace(result.filePath);
              buildMenu();
              const state = focused ? windows.get(focused) : undefined;
              // Stub window (no workspace yet): take over this window
              // Already has a workspace: open a new window
              try {
                await openProjectWindow(
                  result.filePath,
                  !state?.workspace ? focused ?? undefined : undefined,
                );
              } catch (err) {
                console.error("Failed to open project:", err);
                dialog.showErrorBox("Failed to open project", String(err));
              }
            }
          },
        },
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: async () => {
            const focused = BrowserWindow.getFocusedWindow();
            const result = focused
              ? await dialog.showOpenDialog(focused, {
                  properties: ["openDirectory"],
                  title: "Open Workspace Folder",
                })
              : await dialog.showOpenDialog({
                  properties: ["openDirectory"],
                  title: "Open Workspace Folder",
                });
            if (!result.canceled && result.filePaths[0]) {
              const p = result.filePaths[0];
              saveLastWorkspace(p);
              addRecentWorkspace(p);
              buildMenu();
              const state = focused ? windows.get(focused) : undefined;
              try {
                await openProjectWindow(
                  p,
                  !state?.workspace ? focused ?? undefined : undefined,
                );
              } catch (err) {
                console.error("Failed to open project:", err);
                dialog.showErrorBox("Failed to open project", String(err));
              }
            }
          },
        },
        {
          label: "Open Recent",
          submenu: openRecentSubmenu,
        },
        { type: "separator" },
        {
          label: "Generate Static Site…",
          accelerator: "CmdOrCtrl+Shift+G",
          click: async () => {
            const focused = BrowserWindow.getFocusedWindow();
            const state = focused ? windows.get(focused) : undefined;
            const workspace = state?.workspace;

            if (!workspace) {
              const opts = {
                type: "info" as const,
                message: "No workspace is open.",
                detail: "Open a folder first, then generate the static site.",
              };
              if (focused) await dialog.showMessageBox(focused, opts);
              else await dialog.showMessageBox(opts);
              return;
            }

            const result = focused
              ? await dialog.showOpenDialog(focused, {
                  properties: ["openDirectory", "createDirectory"],
                  title: "Choose Output Folder",
                  buttonLabel: "Generate Here",
                })
              : await dialog.showOpenDialog({
                  properties: ["openDirectory", "createDirectory"],
                  title: "Choose Output Folder",
                  buttonLabel: "Generate Here",
                });
            if (result.canceled || !result.filePaths[0]) return;
            const outputDir = result.filePaths[0];

            const proc = spawn(
              bunBin(),
              [
                path.join("packages", "app-episteme", "src", "ssg", "generate.ts"),
                `--workspace=${workspace}`,
                `--output=${outputDir}`,
              ],
              { cwd: repoRoot(), stdio: ["ignore", "pipe", "pipe"] },
            );

            proc.stderr?.on("data", (d: Buffer) => process.stderr.write(d));

            proc.on("exit", async (code) => {
              if (code === 0) {
                const msgOpts = {
                  type: "info" as const,
                  message: "Static site generated!",
                  buttons: ["Open in Finder", "OK"],
                  defaultId: 1,
                };
                const { response } = focused
                  ? await dialog.showMessageBox(focused, msgOpts)
                  : await dialog.showMessageBox(msgOpts);
                if (response === 0) shell.openPath(outputDir);
              } else {
                dialog.showErrorBox("Generation failed", "Check the console for details.");
              }
            });
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- IPC handlers ---

ipcMain.handle("open-folder", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;

  const result = await dialog.showOpenDialog(win, {
    properties: ["openDirectory"],
    title: "Open Workspace Folder",
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const selectedPath = result.filePaths[0];
  saveLastWorkspace(selectedPath);
  addRecentWorkspace(selectedPath);
  buildMenu();

  // Return the path so the renderer can POST it to the stub server.
  // The stub exits(0) → the exit handler in openProjectWindow reloads this window.
  return selectedPath;
});

ipcMain.handle("create-project", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;

  const result = await dialog.showSaveDialog(win, {
    title: "Create New Project",
    buttonLabel: "Create",
    nameFieldLabel: "Project name:",
    showsTagField: false,
  });
  if (result.canceled || !result.filePath) return null;

  fs.mkdirSync(result.filePath, { recursive: true });
  saveLastWorkspace(result.filePath);
  addRecentWorkspace(result.filePath);
  buildMenu();

  return result.filePath;
});

ipcMain.handle("get-recent-folders", () => readRecentWorkspaces());

ipcMain.handle("get-app-version", () => app.getVersion());

// --- App lifecycle ---

app.whenReady().then(async () => {
  const lastWorkspace = readLastWorkspace();
  try {
    await openProjectWindow(lastWorkspace);
  } catch (err) {
    console.error("Failed to start server:", err);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (windows.size === 0) {
    openProjectWindow(readLastWorkspace()).catch((err) => {
      console.error("Failed to open project window:", err);
    });
  }
});

app.on("will-quit", () => {
  for (const state of windows.values()) {
    state.process?.kill();
  }
});
