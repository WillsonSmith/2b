import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

contextBridge.exposeInMainWorld("__electronShell", {
  openFolder: () => ipcRenderer.invoke("open-folder"),
  createProject: () => ipcRenderer.invoke("create-project"),
  getRecentFolders: () => ipcRenderer.invoke("get-recent-folders"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPreference: (key: string) => ipcRenderer.invoke("get-preference", key),
  setPreference: (key: string, value: string) => ipcRenderer.invoke("set-preference", key, value),
  onMenuCommand: (callback: (command: string) => void) => {
    const listener = (_event: IpcRendererEvent, command: string) => callback(command);
    ipcRenderer.on("menu-command", listener);
    return () => {
      ipcRenderer.removeListener("menu-command", listener);
    };
  },
  updateMenuState: (state: Record<string, boolean>) =>
    ipcRenderer.invoke("update-menu-state", state),
});
