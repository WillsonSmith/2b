import type { IShell, MenuState } from "./IShell.ts";

export class BrowserShell implements IShell {
  openFolder(): Promise<string | null> {
    return Promise.resolve(null);
  }
  createProject(): Promise<string | null> {
    return Promise.resolve(null);
  }
  getRecentFolders(): Promise<string[]> {
    return Promise.resolve([]);
  }
  getAppVersion(): Promise<string> {
    return Promise.resolve("dev");
  }
  getPreference(key: string): Promise<string | null> {
    return Promise.resolve(localStorage.getItem(key));
  }
  setPreference(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
    return Promise.resolve();
  }
  onMenuCommand(_callback: (command: string) => void): () => void {
    return () => {};
  }
  updateMenuState(_state: MenuState): Promise<void> {
    return Promise.resolve();
  }
  platform(): "browser" {
    return "browser";
  }
}
