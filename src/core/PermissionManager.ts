import * as readline from "node:readline";
import { logger } from "../logger.ts";

export type PermissionLevel = "none" | "once" | "always";

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

  constructor(options: { timeoutMs?: number; cache?: SessionCache } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.cache = options.cache ?? new SessionCache();
  }

  isSessionApproved(toolName: string): boolean {
    return this.cache.has(toolName);
  }

  async requestApproval(request: PermissionRequest): Promise<boolean> {
    if (this.cache.has(request.toolName)) return true;

    const timeoutSec = Math.round(this.timeoutMs / 1000);
    process.stdout.write(buildPrompt(request, timeoutSec));

    const answer = await this.promptWithTimeout();
    const normalized = answer.trim().toLowerCase();

    if (normalized === "a" || normalized === "always") {
      this.cache.add(request.toolName);
      process.stdout.write(`Approved for this session.\n`);
      return true;
    }
    if (normalized === "y" || normalized === "yes") {
      return true;
    }

    process.stdout.write(`Denied.\n`);
    return false;
  }

  private promptWithTimeout(): Promise<string> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
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
        process.stdout.write(`\nAuto-denied (timeout after ${Math.round(this.timeoutMs / 1000)}s).\n`);
        settle("n");
      }, this.timeoutMs);

      rl.once("line", (line) => settle(line));
      rl.once("close", () => settle("n"));
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

/** Returns pre-scripted responses per tool name; denies anything not listed. Use in tests only. */
export class ScriptedPermissionManager implements PermissionManager {
  private readonly responses: Map<string, boolean>;

  constructor(responses: Record<string, boolean> = {}) {
    this.responses = new Map(Object.entries(responses));
  }

  async requestApproval(request: PermissionRequest): Promise<boolean> {
    return this.responses.get(request.toolName) ?? false;
  }

  isSessionApproved(_toolName: string): boolean {
    return false;
  }
}
