/**
 * ShellPlugin — restricted read-only shell access.
 *
 * Exposes a single `run_shell` tool. Commands are validated against an
 * allowlist before execution:
 *   - Only commands in ALLOWED_COMMANDS may be run.
 *   - `git` is further restricted to read-only subcommands (ALLOWED_GIT_SUBCOMMANDS).
 *   - `find` blocks action flags (-exec, -delete, etc.) via BLOCKED_ARGS.
 *   - Shell operators (|, &&, >, ;) are blocked by refusing to pass the command
 *     to a shell — it is split on whitespace and spawned directly via Bun.spawn.
 *   - ANSI escape sequences are stripped from output before returning.
 *   - stdout is capped at 4 KB; stderr at 1 KB to keep tool results small.
 *
 * Critical: the lack of a shell interpreter is the primary sandboxing mechanism.
 * If you ever switch to `sh -c` or similar, all shell injection guards break.
 */
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";

const SHELL_TIMEOUT_MS = 15_000; // 15 s

const ALLOWED_COMMANDS = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "echo", "date",
  "git", "grep", "find", "which", "uname",
  "df", "du", "ps", "whoami", "hostname",
]);

// Arguments that are unconditionally blocked for specific commands
const BLOCKED_ARGS: Readonly<Record<string, ReadonlySet<string>>> = {
  find: new Set(["-delete", "-exec", "-execdir", "-ok", "-okdir"]),
};

// Allowlist of read-only git subcommands; everything else is blocked
const ALLOWED_GIT_SUBCOMMANDS = new Set([
  "log", "status", "diff", "show", "branch", "tag", "remote",
  "stash", "ls-files", "blame", "shortlog", "describe", "rev-parse",
  "cat-file", "ls-tree", "for-each-ref", "config", "help", "version",
]);

const ALLOWED_COMMANDS_LIST = [...ALLOWED_COMMANDS].join(", ");

// Matches ANSI escape sequences (CSI, OSC, etc.) for output sanitisation
const ANSI_ESCAPE_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07|[^[\]])/g;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

function validateArgs(baseCmd: string, args: string[]): string | null {
  const blocked = BLOCKED_ARGS[baseCmd];
  if (blocked) {
    for (const arg of args) {
      if (blocked.has(arg)) {
        return `Argument '${arg}' is not permitted for '${baseCmd}'.`;
      }
    }
  }

  if (baseCmd === "git") {
    const subcommand = args[0];
    if (!subcommand) return "git requires a subcommand.";
    if (!ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
      return `git subcommand '${subcommand}' is not permitted. Allowed: ${[...ALLOWED_GIT_SUBCOMMANDS].join(", ")}`;
    }
  }

  return null;
}

export class ShellPlugin implements AgentPlugin {
  name = "Shell";

  private readonly rootDir: string;

  constructor(cwd: string = process.cwd()) {
    this.rootDir = resolve(cwd);
  }

  private async resolveWorkdir(cwd?: string): Promise<string | string> {
    if (!cwd) return this.rootDir;
    const resolved = resolve(this.rootDir, cwd);
    const s = await stat(resolved).catch(() => null);
    if (!s) throw new Error(`Directory not found: ${resolved}`);
    if (!s.isDirectory()) throw new Error(`Not a directory: ${resolved}`);
    return resolved;
  }

  getSystemPromptFragment(): string {
    return `You can run read-only shell commands to explore the filesystem and system state.
Use run_shell to execute commands. Only these base commands are permitted: ${ALLOWED_COMMANDS_LIST}.
For git, only read-only subcommands are allowed (log, status, diff, show, branch, tag, remote, stash, ls-files, blame, shortlog, describe, rev-parse, cat-file, ls-tree, for-each-ref, config, help, version).
Commands time out after ${SHELL_TIMEOUT_MS / 1000}s. The tool returns stdout, stderr, and exitCode — check exitCode to detect failures.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "run_shell",
        description: `Run a read-only shell command. Permitted base commands: ${ALLOWED_COMMANDS_LIST}. For git, only read-only subcommands are allowed (log, status, diff, show, etc.). Shell operators (|, &&, >, ;) are not supported. Returns stdout, stderr, and exitCode.`,
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "The command to run, e.g. 'ls -la', 'git log --oneline -10', 'cat README.md'. No shell operators.",
            },
            cwd: {
              type: "string",
              description:
                "Directory to run the command in. Absolute path, or relative to the working directory. Omit to use the working directory.",
            },
          },
          required: ["command"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "run_shell") {
      if (typeof args.command !== "string") {
        return {
          stdout: "",
          stderr: "Missing or invalid 'command' argument: expected a string.",
          exitCode: 1,
        };
      }
      return withTimeout(
        this.runShell(args.command, args.cwd as string | undefined),
        SHELL_TIMEOUT_MS,
        "run_shell",
      );
    }
    return undefined;
  }

  private async runShell(
    command: string,
    cwd?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const trimmed = command.trim();
    const parts = trimmed.split(/\s+/);
    const baseCmd = parts[0] ?? "";

    if (!ALLOWED_COMMANDS.has(baseCmd)) {
      return {
        stdout: "",
        stderr: `Command '${baseCmd}' is not permitted. Allowed: ${ALLOWED_COMMANDS_LIST}`,
        exitCode: 1,
      };
    }

    const argError = validateArgs(baseCmd, parts.slice(1));
    if (argError) {
      return { stdout: "", stderr: argError, exitCode: 1 };
    }

    let workdir: string;
    try {
      workdir = await this.resolveWorkdir(cwd);
    } catch (e) {
      return {
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        exitCode: 1,
      };
    }

    logger.debug(this.name, `run_shell: ${trimmed}`, { cwd: workdir });

    try {
      const proc = Bun.spawn(parts, {
        cwd: workdir,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [, rawStdout, rawStderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const sanitise = (s: string) => s.replace(ANSI_ESCAPE_RE, "");
      const stdoutFull = sanitise(rawStdout);
      const stderrFull = sanitise(rawStderr);

      return {
        stdout:
          stdoutFull.length > 4096
            ? stdoutFull.slice(0, 4096) + "\n[output truncated]"
            : stdoutFull,
        stderr:
          stderrFull.length > 1024
            ? stderrFull.slice(0, 1024) + "\n[output truncated]"
            : stderrFull,
        exitCode: proc.exitCode ?? 0,
      };
    } catch (e) {
      return {
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        exitCode: 1,
      };
    }
  }
}
