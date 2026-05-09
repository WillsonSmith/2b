import type { IShell } from "./IShell.ts";

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
  platform(): "browser" {
    return "browser";
  }
}
