import type { IShell } from "./IShell.ts";

export class ElectronShell implements IShell {
  openFolder(): Promise<string | null> {
    return (window as any).__electronShell.openFolder();
  }
  createProject(): Promise<string | null> {
    return (window as any).__electronShell.createProject();
  }
  getRecentFolders(): Promise<string[]> {
    return (window as any).__electronShell.getRecentFolders();
  }
  getAppVersion(): Promise<string> {
    return (window as any).__electronShell.getAppVersion();
  }
  platform(): "electron" {
    return "electron";
  }
}
