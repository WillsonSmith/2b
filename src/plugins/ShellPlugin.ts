import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const ALLOWED_COMMANDS = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "echo", "date",
  "git", "grep", "find", "which", "uname",
  "df", "du", "ps", "whoami", "hostname",
]);

const ALLOWED_COMMANDS_LIST = [...ALLOWED_COMMANDS].join(", ");

// Matches ANSI escape sequences (CSI, OSC, etc.) for output sanitisation
const ANSI_ESCAPE_RE = /\x1b(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07|[^[\]])/g;

export class ShellPlugin implements AgentPlugin {
  name = "Shell";

  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  getSystemPromptFragment(): string {
    return `You can run read-only shell commands to explore the filesystem and system state.
Use run_shell to execute commands. Only these base commands are permitted: ${ALLOWED_COMMANDS_LIST}.
Commands that modify files, install packages, or affect system state are not allowed.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "run_shell",
        description: `Run a read-only shell command. Permitted base commands: ${ALLOWED_COMMANDS_LIST}. Use this to list files, read content, check git status, or inspect the environment. Shell operators (|, &&, >, ;) are not supported.`,
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description:
                "The command to run, e.g. 'ls -la', 'git log --oneline -10', 'cat README.md'. No shell operators.",
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
      return this.runShell(args.command);
    }
    return undefined;
  }

  private async runShell(
    command: string,
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

    logger.debug(this.name, `run_shell: ${trimmed}`);

    try {
      // Run directly via Bun.spawn — no shell interpretation, so operators are ignored
      const proc = Bun.spawn(parts, {
        cwd: this.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Await process exit first so exitCode is guaranteed to be set,
      // then drain the streams.
      const [, rawStdout, rawStderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const sanitise = (s: string) => s.replace(ANSI_ESCAPE_RE, "");
      const stdoutFull = sanitise(rawStdout);
      const stderrFull = sanitise(rawStderr);

      return {
        stdout: stdoutFull.length > 4096 ? stdoutFull.slice(0, 4096) + "\n[output truncated]" : stdoutFull,
        stderr: stderrFull.length > 1024 ? stderrFull.slice(0, 1024) + "\n[output truncated]" : stderrFull,
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
