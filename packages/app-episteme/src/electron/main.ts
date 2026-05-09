import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from "electron";
import { spawn, type ChildProcess } from "child_process";
import * as net from "net";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let currentPort = 4000;

const CONFIG_DIR = path.join(os.homedir(), ".config", "episteme");
const LAST_WORKSPACE_FILE = path.join(CONFIG_DIR, "last-workspace");
const RECENT_WORKSPACES_FILE = path.join(CONFIG_DIR, "recent-workspaces.json");
const MAX_RECENT = 10;

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

function findFreePort(start = 4000): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(start, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
    server.on("error", () =>
      findFreePort(start + 1)
        .then(resolve)
        .catch(reject),
    );
  });
}

function repoRoot(): string {
  if (app.isPackaged) {
    // In a packaged app the repo is bundled under Contents/Resources/app
    return path.join(process.resourcesPath, "app");
  }
  // electron/ is at packages/app-episteme/src/electron/ — repo root is 4 levels up from there, 5 from dist/
  return path.resolve(__dirname, "..", "..", "..", "..", "..");
}

function bunBin(): string {
  if (app.isPackaged) {
    const ext = process.platform === "win32" ? ".exe" : "";
    return path.join(process.resourcesPath, "bin", `bun${ext}`);
  }
  return "bun";
}

function startServer(port: number, workspace?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [path.join("packages", "app-episteme", "episteme.ts"), `--port=${port}`];
    if (workspace) args.push(`--workspace=${workspace}`);

    serverProcess = spawn(bunBin(), args, {
      cwd: repoRoot(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    serverProcess.stdout?.on("data", (data: Buffer) => {
      const text = data.toString();
      process.stdout.write(text);
      if (text.includes("Episteme running")) resolve();
    });

    serverProcess.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(data);
    });

    serverProcess.on("error", reject);

    // Resolve after timeout as fallback if stdout signal doesn't fire
    setTimeout(resolve, 5000);
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

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu(port: number): void {
  const recents = readRecentWorkspaces();

  const openRecentSubmenu: Electron.MenuItemConstructorOptions[] =
    recents.length > 0
      ? [
          ...recents.map((p) => ({
            label: path.basename(p),
            sublabel: p,
            click: async () => {
              saveLastWorkspace(p);
              addRecentWorkspace(p);
              await restartWithWorkspace(p, port);
            },
          })),
          { type: "separator" as const },
          {
            label: "Clear Recents",
            click: () => {
              fs.writeFileSync(RECENT_WORKSPACES_FILE, "[]", "utf8");
              buildMenu(port);
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
            const result = await dialog.showSaveDialog(mainWindow!, {
              title: "Create New Project",
              buttonLabel: "Create",
              nameFieldLabel: "Project name:",
              showsTagField: false,
            });
            if (!result.canceled && result.filePath) {
              fs.mkdirSync(result.filePath, { recursive: true });
              saveLastWorkspace(result.filePath);
              addRecentWorkspace(result.filePath);
              await restartWithWorkspace(result.filePath, port);
            }
          },
        },
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+Shift+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ["openDirectory"],
              title: "Open Workspace Folder",
            });
            if (!result.canceled && result.filePaths[0]) {
              const selectedPath = result.filePaths[0];
              saveLastWorkspace(selectedPath);
              addRecentWorkspace(selectedPath);
              await restartWithWorkspace(selectedPath, port);
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
            const workspace = readLastWorkspace();
            if (!workspace) {
              dialog.showMessageBox(mainWindow!, {
                type: "info",
                message: "No workspace is open.",
                detail: "Open a folder first, then generate the static site.",
              });
              return;
            }

            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ["openDirectory", "createDirectory"],
              title: "Choose Output Folder",
              buttonLabel: "Generate Here",
            });
            if (result.canceled || !result.filePaths[0]) return;
            const outputDir = result.filePaths[0];

            const proc = spawn(bunBin(), [
              path.join("packages", "app-episteme", "src", "ssg", "generate.ts"),
              `--workspace=${workspace}`,
              `--output=${outputDir}`,
            ], { cwd: repoRoot(), stdio: ["ignore", "pipe", "pipe"] });

            proc.stderr?.on("data", (d: Buffer) => process.stderr.write(d));

            proc.on("exit", async (code) => {
              if (code === 0) {
                const { response } = await dialog.showMessageBox(mainWindow!, {
                  type: "info",
                  message: "Static site generated!",
                  buttons: ["Open in Finder", "OK"],
                  defaultId: 1,
                });
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

async function restartWithWorkspace(
  workspacePath: string,
  port: number,
): Promise<void> {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    await new Promise((r) => setTimeout(r, 500));
  }
  await startServer(port, workspacePath);
  await waitForServer(port);
  mainWindow?.loadURL(`http://localhost:${port}`);
  buildMenu(port);
}

// IPC handlers
ipcMain.handle("open-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ["openDirectory"],
    title: "Open Workspace Folder",
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const selectedPath = result.filePaths[0];
  saveLastWorkspace(selectedPath);
  addRecentWorkspace(selectedPath);
  return selectedPath;
});

ipcMain.handle("create-project", async () => {
  const result = await dialog.showSaveDialog(mainWindow!, {
    title: "Create New Project",
    buttonLabel: "Create",
    nameFieldLabel: "Project name:",
    showsTagField: false,
  });
  if (result.canceled || !result.filePath) return null;
  fs.mkdirSync(result.filePath, { recursive: true });
  saveLastWorkspace(result.filePath);
  addRecentWorkspace(result.filePath);
  return result.filePath;
});

ipcMain.handle("get-recent-folders", () => readRecentWorkspaces());

ipcMain.handle("get-app-version", () => app.getVersion());

app.whenReady().then(async () => {
  currentPort = await findFreePort(4000);
  const lastWorkspace = readLastWorkspace();

  try {
    await startServer(currentPort, lastWorkspace);
    await waitForServer(currentPort);
  } catch (err) {
    console.error("Failed to start server:", err);
    app.quit();
    return;
  }

  createWindow(currentPort);
  buildMenu(currentPort);

  // When server exits with code 0 (workspace set via POST /api/workspace),
  // the frontend already has the workspace path saved to disk — reload.
  serverProcess?.on("exit", async (code) => {
    if (code === 0 && mainWindow) {
      const workspace = readLastWorkspace();
      try {
        await startServer(currentPort, workspace);
        await waitForServer(currentPort);
        mainWindow.loadURL(`http://localhost:${currentPort}`);
      } catch (err) {
        console.error("Failed to restart server:", err);
      }
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow(currentPort);
});

app.on("will-quit", () => {
  serverProcess?.kill();
});
