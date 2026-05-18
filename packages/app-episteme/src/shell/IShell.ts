export interface IShell {
  openFolder(): Promise<string | null>;
  createProject(): Promise<string | null>;
  getRecentFolders(): Promise<string[]>;
  getAppVersion(): Promise<string>;
  getPreference(key: string): Promise<string | null>;
  setPreference(key: string, value: string): Promise<void>;
  platform(): "electron" | "tauri" | "browser";
}
