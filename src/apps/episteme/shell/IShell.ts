export interface IShell {
  openFolder(): Promise<string | null>;
  getAppVersion(): Promise<string>;
  platform(): "electron" | "tauri" | "browser";
}
