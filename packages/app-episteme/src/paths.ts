import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

/** Ensure directory exists and return its path. */
function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path to `{workspaceRoot}/.episteme/`, created if absent. */
export function workspaceEpistemePath(workspaceRoot: string): string {
  return ensureDir(join(resolve(workspaceRoot), ".episteme"));
}

/** SQLite DB path for the workspace-scoped agent memory. */
export function workspaceDbPath(workspaceRoot: string): string {
  return join(workspaceEpistemePath(workspaceRoot), "agent.sqlite");
}

/** Path to the per-project model/feature config JSON. */
export function workspaceConfigPath(workspaceRoot: string): string {
  return join(workspaceEpistemePath(workspaceRoot), "config.json");
}

/** Path to the optional style guide ruleset for this workspace. */
export function workspaceStyleGuidePath(workspaceRoot: string): string {
  return join(workspaceEpistemePath(workspaceRoot), "style-guide.md");
}

/** Absolute path to `~/.config/episteme/`, created if absent. */
export function globalEpistemePath(): string {
  return ensureDir(join(homedir(), ".config", "episteme"));
}

/** SQLite DB path for the global (cross-workspace) shared memory. */
export function globalDbPath(): string {
  return join(globalEpistemePath(), "global.sqlite");
}
