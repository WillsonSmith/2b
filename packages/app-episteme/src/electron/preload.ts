import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__electronShell", {
  openFolder: () => ipcRenderer.invoke("open-folder"),
  createProject: () => ipcRenderer.invoke("create-project"),
  getRecentFolders: () => ipcRenderer.invoke("get-recent-folders"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
});
