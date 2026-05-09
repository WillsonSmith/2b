import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__electronShell", {
  openFolder: () => ipcRenderer.invoke("open-folder"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
});
