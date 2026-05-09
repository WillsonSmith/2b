/**
 * VerificationPlugin — four post-action verification tools.
 *
 * Provides explicit primitives for the agent to confirm that an action had the
 * intended effect. Tools return VerificationResult objects so the LLM can see
 * whether its prior action actually succeeded.
 *
 * Tools:
 *   verify_file_contains   — check a file contains a literal substring or regex
 *   verify_shell_output    — run an allowlisted command and check its stdout
 *   verify_memory_exists   — confirm that at least N memories match a query
 *   verify_expression      — LLM-evaluated assertion on any free-form value
 *
 * Also exports `fileContainsCheck` and `shellOutputCheck` as standalone helpers
 * so they can be used as `verifyAfter` hooks on ToolDefinitions without
 * constructing the full plugin.
 */
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { VerificationResult } from "../core/types.ts";
import type { CortexMemoryPlugin } from "./CortexMemoryPlugin.ts";
import { resolve } from "node:path";
import { logger } from "../logger.ts";

const FILE_TIMEOUT_MS = 10_000;
const SHELL_TIMEOUT_MS = 15_000;
const MAX_READ_BYTES = 1_048_576; // 1 MB

// ── Shell allowlist (mirrors ShellPlugin; no import to avoid coupling) ────────

const ALLOWED_COMMANDS = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "echo", "date",
  "git", "grep", "find", "which", "uname",
  "df", "du", "ps", "whoami", "hostname",
]);

const BLOCKED_ARGS: Readonly<Record<string, ReadonlySet<string>>> = {
  find: new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir"]),
};

const ALLOWED_GIT_SUBCOMMANDS = new Set([
  "log", "status", "diff", "show", "branch", "tag", "remote",
  "stash", "ls-files", "blame", "shortlog", "describe", "rev-parse",
  "cat-file", "ls-tree", "for-each-ref", "config", "help", "version",
]);

const ANSI_ESCAPE_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07|[^[\]])/g;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

function validateShellArgs(baseCmd: string, args: string[]): string | null {
  const blocked = BLOCKED_ARGS[baseCmd];
  if (blocked) {
    for (const arg of args) {
      if (blocked.has(arg)) return `Argument '${arg}' is not permitted for '${baseCmd}'.`;
    }
  }
  if (baseCmd === "git") {
    const sub = args[0];
    if (!sub) return "git requires a subcommand.";
    if (!ALLOWED_GIT_SUBCOMMANDS.has(sub)) {
      return `git subcommand '${sub}' is not permitted.`;
    }
  }
  return null;
}

// ── Standalone helper functions (usable as verifyAfter hooks) ─────────────────

/**
 * Read a file and check whether it contains `pattern` (literal or regex).
 * Paths are resolved relative to process.cwd() for sandboxing.
 */
export async function fileContainsCheck(
  filePath: string,
  pattern: string,
  isRegex = false,
): Promise<VerificationResult> {
  // resolve() normalises traversal sequences (../../etc). The check below
  // prevents paths that resolve outside the filesystem root (impossible in
  // practice, but guards against crafted inputs like "/../../etc").
  const safe = resolve(filePath);
  if (safe.includes("\0")) {
    return { passed: false, actual: filePath, expected: "valid path", message: "Invalid path: null byte." };
  }
  let content: string;
  try {
    const buf = await withTimeout(Bun.file(safe).arrayBuffer(), FILE_TIMEOUT_MS, "verify_file_contains");
    if (buf.byteLength > MAX_READ_BYTES) {
      return { passed: false, actual: `${buf.byteLength} bytes`, expected: `<= ${MAX_READ_BYTES}`, message: "File too large to verify." };
    }
    content = new TextDecoder().decode(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { passed: false, actual: "error reading file", expected: pattern, message: msg };
  }

  const matched = isRegex
    ? new RegExp(pattern).test(content)
    : content.includes(pattern);

  return {
    passed: matched,
    actual: matched ? "(matched)" : "(not found)",
    expected: pattern,
    message: matched
      ? `Pattern found in ${filePath}.`
      : `Pattern not found in ${filePath}.`,
  };
}

/**
 * Run an allowlisted shell command and check whether stdout contains `pattern`.
 */
export async function shellOutputCheck(
  command: string,
  pattern: string,
  isRegex = false,
): Promise<VerificationResult> {
  const parts = command.trim().split(/\s+/);
  const baseCmd = parts[0] ?? "";

  if (!ALLOWED_COMMANDS.has(baseCmd)) {
    return { passed: false, actual: baseCmd, expected: "allowlisted command", message: `Command '${baseCmd}' is not permitted.` };
  }
  const argErr = validateShellArgs(baseCmd, parts.slice(1));
  if (argErr) {
    return { passed: false, actual: command, expected: "valid arguments", message: argErr };
  }

  let stdout = "";
  try {
    const proc = Bun.spawn(parts, { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" });
    const [, raw] = await withTimeout(
      Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]),
      SHELL_TIMEOUT_MS,
      "verify_shell_output",
    );
    stdout = raw.replace(ANSI_ESCAPE_RE, "").slice(0, 4096);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { passed: false, actual: "error running command", expected: pattern, message: msg };
  }

  const matched = isRegex
    ? new RegExp(pattern).test(stdout)
    : stdout.includes(pattern);

  return {
    passed: matched,
    actual: stdout.slice(0, 200),
    expected: pattern,
    message: matched
      ? `Pattern found in output of: ${command}`
      : `Pattern not found in output of: ${command}`,
  };
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export class VerificationPlugin implements AgentPlugin {
  name = "Verification";

  constructor(
    private readonly llm: LLMProvider,
    private readonly memoryPlugin?: CortexMemoryPlugin,
  ) {}

  getSystemPromptFragment(): string {
    return [
      "## Verification",
      "Use verify_* tools after any action where correctness matters:",
      "  verify_file_contains  — confirm a file contains expected content after a write",
      "  verify_shell_output   — confirm a shell command produces expected output",
      "  verify_memory_exists  — confirm a fact was persisted to memory",
      "  verify_expression     — confirm any free-form assertion (LLM-evaluated)",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "verify_file_contains",
        description: "Check that a file contains a given substring or regex pattern. Returns passed/failed with the actual content snippet.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path relative to the working directory." },
            pattern: { type: "string", description: "Literal substring or regex pattern to search for." },
            is_regex: { type: "boolean", description: "Treat pattern as a regular expression. Default: false." },
          },
          required: ["path", "pattern"],
        },
      },
      {
        name: "verify_shell_output",
        description: "Run an allowlisted read-only shell command and check that its stdout contains a given pattern. Same command allowlist as run_shell.",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "The shell command to run (allowlisted commands only; no shell operators)." },
            pattern: { type: "string", description: "Literal substring or regex pattern to find in stdout." },
            is_regex: { type: "boolean", description: "Treat pattern as a regular expression. Default: false." },
          },
          required: ["command", "pattern"],
        },
      },
      {
        name: "verify_memory_exists",
        description: "Check that at least N memories containing the query text exist in long-term memory.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Text to search for in memory contents." },
            minimum_count: { type: "number", description: "Minimum number of matching memories required. Default: 1." },
          },
          required: ["query"],
        },
      },
      {
        name: "verify_expression",
        description: "Verify any free-form assertion by asking the LLM to evaluate it. Use when no structural check applies. Returns passed/failed based on YES/NO from the evaluator.",
        parameters: {
          type: "object",
          properties: {
            description: { type: "string", description: "The condition or expectation to check, e.g. 'the JSON is valid' or 'the response mentions the user name'." },
            actual_value: { type: "string", description: "The value to evaluate against the condition." },
          },
          required: ["description", "actual_value"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "verify_file_contains": {
        const { path, pattern, is_regex } = args as { path: string; pattern: string; is_regex?: boolean };
        return fileContainsCheck(path, pattern, is_regex ?? false);
      }

      case "verify_shell_output": {
        const { command, pattern, is_regex } = args as { command: string; pattern: string; is_regex?: boolean };
        return shellOutputCheck(command, pattern, is_regex ?? false);
      }

      case "verify_memory_exists": {
        const { query, minimum_count } = args as { query: string; minimum_count?: number };
        const minCount = minimum_count ?? 1;
        if (!this.memoryPlugin) {
          return {
            passed: false,
            actual: "no memory plugin",
            expected: `>= ${minCount} memories`,
            message: "VerificationPlugin was constructed without a CortexMemoryPlugin — cannot query memory.",
          } satisfies VerificationResult;
        }
        const matches = this.memoryPlugin.queryMemoriesRaw({ contains: query });
        const count = matches.length;
        return {
          passed: count >= minCount,
          actual: `${count} memories found`,
          expected: `>= ${minCount} memories containing "${query}"`,
          message: count >= minCount
            ? `Found ${count} memories matching "${query}".`
            : `Only ${count} memories match "${query}" (need >= ${minCount}).`,
        } satisfies VerificationResult;
      }

      case "verify_expression": {
        const { description, actual_value } = args as { description: string; actual_value: string };
        return this.verifyExpression(description, actual_value);
      }

      default:
        return undefined;
    }
  }

  private async verifyExpression(description: string, actualValue: string): Promise<VerificationResult> {
    const prompt = `You are a verification assistant. Answer with exactly "YES" or "NO" on the first line, then one sentence of explanation.

Condition: ${description}
Value to evaluate: ${actualValue}

Does the value satisfy the condition?`;

    try {
      const { nonReasoningContent } = await this.llm.chat(
        [{ role: "user", content: prompt }],
        "You are a strict verification assistant. Answer YES or NO first.",
      );
      const firstLine = nonReasoningContent.trim().split("\n")[0]?.trim().toUpperCase() ?? "";
      const passed = firstLine.startsWith("YES");
      const explanation = nonReasoningContent.trim().split("\n").slice(1).join(" ").trim();
      return {
        passed,
        actual: actualValue.slice(0, 200),
        expected: description,
        message: explanation || (passed ? "Condition satisfied." : "Condition not satisfied."),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(this.name, "verify_expression LLM call failed:", e);
      return { passed: false, actual: actualValue.slice(0, 200), expected: description, message: `Evaluator error: ${msg}` };
    }
  }
}
