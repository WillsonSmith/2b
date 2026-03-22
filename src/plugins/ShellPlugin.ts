import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const ALLOWED_COMMANDS = new Set([
  "ls", "pwd", "cat", "head", "tail", "wc", "echo", "date",
  "git", "grep", "find", "which", "env", "printenv", "uname",
  "df", "du", "ps", "whoami", "hostname",
]);

export class ShellPlugin implements AgentPlugin {
  name = "Shell";

  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
  }

  getSystemPromptFragment(): string {
    const allowed = [...ALLOWED_COMMANDS].join(", ");
    return `You can run read-only shell commands to explore the filesystem and system state.
Use run_shell to execute commands. Only these base commands are permitted: ${allowed}.
Commands that modify files, install packages, or affect system state are not allowed.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "run_shell",
        description: `Run a read-only shell command. Permitted base commands: ${[...ALLOWED_COMMANDS].join(", ")}. Use this to list files, read content, check git status, or inspect the environment. Shell operators (|, &&, >, ;) are not supported.`,
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

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "run_shell") {
      return this.runShell(args.command);
    }
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
        stderr: `Command '${baseCmd}' is not permitted. Allowed: ${[...ALLOWED_COMMANDS].join(", ")}`,
        exitCode: 1,
      };
    }

    logger.debug("Shell", `run_shell: ${trimmed}`);

    try {
      // Run directly via Bun.spawn — no shell interpretation, so operators are ignored
      const proc = Bun.spawn(parts, {
        cwd: this.cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;

      return {
        stdout: stdout.slice(0, 4096),
        stderr: stderr.slice(0, 1024),
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
