#!/usr/bin/env bun
/**
 * Backup script for 2b agent data.
 *
 * Backs up:
 *   - ~/.local/share/2b/data/*.cortex.sqlite  (long-term semantic memory)
 *
 * Output: ~/.local/share/2b/backups/<timestamp>/
 *
 * Usage:
 *   bun run backup           — data backup only
 *   bun run backup --tag     — data backup + git tag
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, readdirSync, existsSync, copyFileSync } from "node:fs";

const XDG_DATA_HOME = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
const APP_DATA_DIR = join(XDG_DATA_HOME, "2b");
const DATA_DIR = join(APP_DATA_DIR, "data");
const BACKUPS_DIR = join(APP_DATA_DIR, "backups");

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const backupDir = join(BACKUPS_DIR, timestamp);

mkdirSync(backupDir, { recursive: true });

let backedUp = 0;

if (existsSync(DATA_DIR)) {
  const cortexDbs = readdirSync(DATA_DIR).filter((f) => f.endsWith(".cortex.sqlite"));
  for (const file of cortexDbs) {
    copyFileSync(join(DATA_DIR, file), join(backupDir, file));
    console.log(`  backed up: ${file}`);
    backedUp++;
  }
}

if (backedUp === 0) {
  console.log("No databases found to back up.");
  process.exit(0);
}

console.log(`\nBackup complete: ${backupDir}`);

// Optional git tag
if (process.argv.includes("--tag")) {
  const tag = `backup-${timestamp}`;
  const result = await Bun.$`git tag ${tag}`.quiet().nothrow();
  if (result.exitCode === 0) {
    console.log(`Git tag created: ${tag}`);
  } else {
    console.error(`Failed to create git tag: ${result.stderr.toString().trim()}`);
  }
}
