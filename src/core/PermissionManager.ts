import * as readline from "node:readline";
import { logger } from "../logger.ts";

// Fix #4: renamed "once" → "per_call" and "always" → "session" to make semantics
// explicit — "per_call" means approve each invocation individually, "session"
// means once approved the grant carries for the lifetime of the session.
export type PermissionLevel = "none" | "per_call" | "session";

export interface PermissionRequest {
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface PermissionManager {
  requestApproval(request: PermissionRequest): Promise<boolean>;
  isSessionApproved(toolName: string): boolean;
}

// ── Session cache ─────────────────────────────────────────────────────────────

export class SessionCache {
  private readonly approved = new Set<string>();

  has(toolName: string): boolean {
    return this.approved.has(toolName);
  }

  add(toolName: string): void {
    this.approved.add(toolName);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_ARG_VALUE_LENGTH = 200;
const BOX_WIDTH = 55;

function formatArgs(args: Record<string, unknown>): string {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && value.length > MAX_ARG_VALUE_LENGTH) {
      sanitized[key] = `${value.slice(0, MAX_ARG_VALUE_LENGTH)}... [${value.length - MAX_ARG_VALUE_LENGTH} chars truncated]`;
    } else {
      sanitized[key] = value;
    }
  }
  return JSON.stringify(sanitized, null, 2);
}

function buildPrompt(request: PermissionRequest, timeoutSec: number): string {
  const argsLines = formatArgs(request.args)
    .split("\n")
    .map((l) => `│   ${l}`)
    .join("\n");

  return (
    `\n┌─ Permission Request ${"─".repeat(BOX_WIDTH - 21)}\n` +
    `│ Agent:  ${request.agentName}\n` +
    `│ Tool:   ${request.toolName}\n` +
    `│ Args:\n${argsLines}\n` +
    `└${"─".repeat(BOX_WIDTH)}\n` +
    `Allow? [y]es once / [a]lways (this session) / [n]o  (auto-deny in ${timeoutSec}s): `
  );
}

// ── InteractivePermissionManager ──────────────────────────────────────────────

export class InteractivePermissionManager implements PermissionManager {
  private readonly cache: SessionCache;
  private readonly timeoutMs: number;
  // Fix #7: accept an optional output stream so the class is testable without
  // coupling to process.stdout.
  private readonly output: NodeJS.WritableStream;

  constructor(options: {
    timeoutMs?: number;
    cache?: SessionCache;
    output?: NodeJS.WritableStream;
  } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.cache = options.cache ?? new SessionCache();
    this.output = options.output ?? process.stdout;
  }

  isSessionApproved(toolName: string): boolean {
    return this.cache.has(toolName);
  }

  async requestApproval(request: PermissionRequest): Promise<boolean> {
    if (this.cache.has(request.toolName)) return true;

    const timeoutSec = Math.round(this.timeoutMs / 1000);
    this.output.write(buildPrompt(request, timeoutSec));

    const answer = await this.promptWithTimeout();
    const normalized = answer.trim().toLowerCase();

    // The [a]lways option is intentionally offered for every tool regardless of
    // whether its permission annotation is "per_call" or "session". User intent
    // overrides the tool annotation — if the user wants to grant session-level
    // approval for a per_call tool, that's their call. The annotation signals
    // the recommended approval granularity to the user, not a hard ceiling.
    if (normalized === "a" || normalized === "always") {
      this.cache.add(request.toolName);
      this.output.write(`Approved for this session.\n`);
      return true;
    }
    if (normalized === "y" || normalized === "yes") {
      return true;
    }

    this.output.write(`Denied.\n`);
    return false;
  }

  private promptWithTimeout(): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        // Fix #7: use this.output instead of process.stdout
        output: this.output as NodeJS.WriteStream,
        terminal: false,
      });

      let settled = false;

      const settle = (value: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { rl.close(); } catch { /* ignore */ }
        resolve(value);
      };

      const timer = setTimeout(() => {
        this.output.write(`\nAuto-denied (timeout after ${Math.round(this.timeoutMs / 1000)}s).\n`);
        settle("n");
      }, this.timeoutMs);

      rl.once("line", (line) => settle(line));
      // Fix #3: distinguish a close-based denial (stdin closed/piped) from a
      // normal "n" response so callers can see why the prompt resolved.
      rl.once("close", () => {
        if (!settled) {
          logger.warn(
            "InteractivePermissionManager",
            "stdin closed before a response was received — auto-denying.",
          );
        }
        settle("n");
      });
    });
  }
}

// ── AutoDenyPermissionManager ─────────────────────────────────────────────────

export class AutoDenyPermissionManager implements PermissionManager {
  private readonly cache: SessionCache;

  constructor(cache?: SessionCache) {
    this.cache = cache ?? new SessionCache();
  }

  async requestApproval(request: PermissionRequest): Promise<boolean> {
    logger.warn(
      "AutoDenyPermissionManager",
      `Tool "${request.toolName}" requires permission but no PermissionManager was provided to agent "${request.agentName}" — auto-denying.`,
    );
    return false;
  }

  isSessionApproved(toolName: string): boolean {
    return this.cache.has(toolName);
  }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Always approves every permission request. Use in tests only. */
export class AutoApprovePermissionManager implements PermissionManager {
  private readonly cache: SessionCache;

  constructor(cache: SessionCache = new SessionCache()) {
    this.cache = cache;
  }

  async requestApproval(_request: PermissionRequest): Promise<boolean> {
    return true;
  }

  isSessionApproved(toolName: string): boolean {
    return this.cache.has(toolName);
  }
}

/**
 * Returns pre-scripted responses per tool name; denies anything not listed.
 * Accepts an optional SessionCache so callers can pre-populate session
 * approvals when testing cache-dependent code paths.
 * Use in tests only.
 */
export class ScriptedPermissionManager implements PermissionManager {
  private readonly responses: Map<string, boolean>;
  // Fix #5: accept optional SessionCache so session-approval code paths can be
  // tested. Defaults to an empty cache (isSessionApproved returns false for
  // all tools unless the caller pre-populates the cache).
  private readonly cache: SessionCache;

  constructor(responses: Record<string, boolean> = {}, cache: SessionCache = new SessionCache()) {
    this.responses = new Map(Object.entries(responses));
    this.cache = cache;
  }

  async requestApproval(request: PermissionRequest): Promise<boolean> {
    return this.responses.get(request.toolName) ?? false;
  }

  isSessionApproved(toolName: string): boolean {
    return this.cache.has(toolName);
  }
}
