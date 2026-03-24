import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

const XDG_DATA_HOME = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");

/** Persistent data directory: ~/.local/share/2b (or $XDG_DATA_HOME/2b) */
export const APP_DATA_DIR = join(XDG_DATA_HOME, "2b");

/**
 * Returns an absolute path inside the app data directory, creating it if needed.
 * Usage: appDataPath("data") → ~/.local/share/2b/data
 */
export function appDataPath(...segments: string[]): string {
  const dir = join(APP_DATA_DIR, ...segments);
  mkdirSync(dir, { recursive: true });
  return dir;
}
