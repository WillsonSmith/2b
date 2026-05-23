export interface MenuState {
  posHighlight?: boolean;
  posNoun?: boolean;
  posVerb?: boolean;
  posAdjective?: boolean;
  posAdverb?: boolean;
}

export interface IShell {
  openFolder(): Promise<string | null>;
  createProject(): Promise<string | null>;
  getRecentFolders(): Promise<string[]>;
  getAppVersion(): Promise<string>;
  getPreference(key: string): Promise<string | null>;
  setPreference(key: string, value: string): Promise<void>;
  onMenuCommand(callback: (command: string) => void): () => void;
  updateMenuState(state: MenuState): Promise<void>;
  platform(): "electron" | "tauri" | "browser";
}
