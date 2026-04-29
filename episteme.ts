#!/usr/bin/env bun
/**
 * Episteme — AI-Powered Markdown Editor and Research Workstation
 *
 * Usage:
 *   bun episteme.ts <workspace-path>
 *   bun episteme.ts ~/notes
 *   bun episteme.ts --port 4001 ~/my-project
 *
 * Environment variables:
 *   MODEL        Chat model name (default from createProvider)
 *   PROVIDER     "lmstudio" (default) or "ollama"
 *   PORT         HTTP port (default: 4000; overridden by --port)
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createEpistemAgent } from "./src/apps/episteme/agent.ts";
import { startEpistemServer } from "./src/apps/episteme/server.ts";
import { loadConfig } from "./src/apps/episteme/config.ts";

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const portFlag = args.indexOf("--port");
const portArg = portFlag !== -1 ? Number(args[portFlag + 1]) : undefined;
const port = portArg ?? (process.env["PORT"] ? Number(process.env["PORT"]) : 4000);

// Workspace path: last non-flag argument
const positional = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  if (i > 0 && args[i - 1] === "--port") return false;
  return true;
});

const workspaceArg = positional[0];

if (!workspaceArg) {
  console.error("Usage: bun episteme.ts <workspace-path>");
  console.error("Example: bun episteme.ts ~/notes");
  process.exit(1);
}

const workspaceRoot = resolve(workspaceArg);

if (!existsSync(workspaceRoot)) {
  console.error(`Workspace directory not found: ${workspaceRoot}`);
  process.exit(1);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

const config = await loadConfig(workspaceRoot);
const bundle = createEpistemAgent(workspaceRoot, config);

await startEpistemServer(bundle, workspaceRoot, config, port);
