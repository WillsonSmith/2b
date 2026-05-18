import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__electronShell", {
  openFolder: () => ipcRenderer.invoke("open-folder"),
  createProject: () => ipcRenderer.invoke("create-project"),
  getRecentFolders: () => ipcRenderer.invoke("get-recent-folders"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getPreference: (key: string) => ipcRenderer.invoke("get-preference", key),
  setPreference: (key: string, value: string) => ipcRenderer.invoke("set-preference", key, value),
});
