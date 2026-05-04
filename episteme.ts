#!/usr/bin/env bun
/**
 * Episteme — AI-Powered Markdown Editor and Research Workstation
 *
 * Usage:
 *   bun episteme.ts <workspace-path>
 *   bun episteme.ts ~/notes
 *   bun episteme.ts --port 4001 ~/my-project
 *   bun episteme.ts --port=4001 --workspace=~/my-project
 *   bun episteme.ts --port=4001          (Electron: workspace picked at runtime)
 *
 * Environment variables:
 *   MODEL        Chat model name (default from createProvider)
 *   PROVIDER     "lmstudio" (default) or "ollama"
 *   PORT         HTTP port (default: 4000; overridden by --port)
 */
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createEpistemAgent } from "./src/apps/episteme/agent.ts";
import { startEpistemServer, startEpistemStubServer } from "./src/apps/episteme/server/index.ts";
import { loadConfig } from "./src/apps/episteme/config.ts";

// ── Parse CLI args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// Support both --port 4001 and --port=4001
const portFlagEq = args.find((a) => a.startsWith("--port="));
const portFlagSpace = args.indexOf("--port");
const portArg = portFlagEq
  ? Number(portFlagEq.slice(7))
  : portFlagSpace !== -1
  ? Number(args[portFlagSpace + 1])
  : undefined;
const port = portArg ?? (process.env["PORT"] ? Number(process.env["PORT"]) : 4000);

// Support --workspace=/path as well as positional arg
const workspaceFlagEq = args.find((a) => a.startsWith("--workspace="));
const positional = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  if (i > 0 && args[i - 1] === "--port") return false;
  return true;
});
const workspaceArg = workspaceFlagEq ? workspaceFlagEq.slice(12) : positional[0];

// ── Bootstrap ──────────────────────────────────────────────────────────────────

if (!workspaceArg) {
  // No workspace — start stub server so the desktop app can show folder picker
  await startEpistemStubServer(port);
} else {
  const workspaceRoot = resolve(workspaceArg);

  if (!existsSync(workspaceRoot)) {
    console.error(`Workspace directory not found: ${workspaceRoot}`);
    process.exit(1);
  }

  const config = await loadConfig(workspaceRoot);
  const bundle = createEpistemAgent(workspaceRoot, config);

  await startEpistemServer(bundle, workspaceRoot, config, port);
}
