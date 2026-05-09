export interface IShell {
  openFolder(): Promise<string | null>;
  createProject(): Promise<string | null>;
  getRecentFolders(): Promise<string[]>;
  getAppVersion(): Promise<string>;
  platform(): "electron" | "tauri" | "browser";
}
