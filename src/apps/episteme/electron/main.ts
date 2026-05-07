import { app, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import { spawn, type ChildProcess } from "child_process";
import * as net from "net";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

let serverProcess: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let currentPort = 4000;

const LAST_WORKSPACE_FILE = path.join(
  os.homedir(),
  ".config",
  "episteme",
  "last-workspace",
);

function readLastWorkspace(): string | undefined {
  try {
    return fs.readFileSync(LAST_WORKSPACE_FILE, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

function saveLastWorkspace(workspacePath: string): void {
  const dir = path.dirname(LAST_WORKSPACE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LAST_WORKSPACE_FILE, workspacePath, "utf8");
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
  // electron/ is at src/apps/episteme/electron/ — repo root is 4 levels up
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
    const args = ["episteme.ts", `--port=${port}`];
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
              await restartWithWorkspace(selectedPath, port);
            }
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
  return selectedPath;
});

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
