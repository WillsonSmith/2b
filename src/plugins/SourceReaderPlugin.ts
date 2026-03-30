import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";

export class SourceReaderPlugin implements AgentPlugin {
  name = "SourceReader";
  private readonly sourceRoot: string;

  constructor(options?: { sourceRoot?: string }) {
    this.sourceRoot = resolve(options?.sourceRoot ?? process.cwd());
  }

  getSystemPromptFragment(): string {
    return `Your source root is: ${this.sourceRoot}`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "read_source_file",
        description:
          "Reads a source file from the agent's codebase. Path is relative to the project root (e.g. 'src/plugins/MetacognitionPlugin.ts').",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path relative to the project root" },
          },
          required: ["path"],
        },
      },
      {
        name: "list_source_dir",
        description:
          "Lists files and subdirectories at a path relative to the project root. Omit path to list the project root.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Directory path relative to the project root (default: project root)",
            },
          },
        },
      },
      {
        name: "grep_source",
        description:
          "Searches the agent's source code for a pattern using ripgrep. Returns matching lines with file paths and line numbers.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regex or literal pattern to search for" },
            path: {
              type: "string",
              description:
                "Directory or file to search within, relative to project root (default: src/)",
            },
            glob: {
              type: "string",
              description: "File glob filter (e.g. '*.ts', default: '*.ts')",
            },
          },
          required: ["pattern"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      if (name === "read_source_file") return this.handleReadSourceFile(args);
      if (name === "list_source_dir") return this.handleListSourceDir(args);
      if (name === "grep_source") return await this.handleGrepSource(args);
    } catch (e) {
      return `Tool error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** Resolve a user-supplied relative path safely within sourceRoot. Returns null if outside. */
  private resolveSafe(userPath: string): string | null {
    const abs = resolve(this.sourceRoot, userPath);
    if (!abs.startsWith(this.sourceRoot)) return null;
    return abs;
  }

  private handleReadSourceFile(args: Record<string, unknown>): string {
    const userPath = String(args.path ?? "");
    if (!userPath) return "path is required.";
    const abs = this.resolveSafe(userPath);
    if (!abs) return `Path '${userPath}' is outside the project root.`;
    if (!existsSync(abs)) return `File not found: ${userPath}`;
    const stat = statSync(abs);
    if (stat.isDirectory()) return `'${userPath}' is a directory. Use list_source_dir instead.`;
    if (stat.size > 500_000) return `File too large (${stat.size} bytes). Max 500 KB.`;
    const content = readFileSync(abs, "utf8");
    return `// ${userPath} (${stat.size} bytes)\n${content}`;
  }

  private handleListSourceDir(args: Record<string, unknown>): string {
    const userPath = String(args.path ?? "");
    const abs = this.resolveSafe(userPath || ".");
    if (!abs) return `Path '${userPath}' is outside the project root.`;
    if (!existsSync(abs)) return `Directory not found: ${userPath || "(project root)"}`;
    const stat = statSync(abs);
    if (!stat.isDirectory()) return `'${userPath}' is a file. Use read_source_file instead.`;

    const entries = readdirSync(abs);
    const lines = entries
      .map((entry) => {
        const full = join(abs, entry);
        const isDir = statSync(full).isDirectory();
        const relPath = relative(this.sourceRoot, full);
        return isDir ? `  ${entry}/  (${relPath})` : `  ${entry}  (${relPath})`;
      })
      .sort();

    const displayPath = userPath || "(project root)";
    return [`${displayPath} — ${entries.length} entries:`, ...lines].join("\n");
  }

  private async handleGrepSource(args: Record<string, unknown>): Promise<string> {
    const pattern = String(args.pattern ?? "");
    if (!pattern) return "pattern is required.";
    const userPath = String(args.path ?? "src");
    const glob = String(args.glob ?? "*.ts");

    const abs = this.resolveSafe(userPath);
    if (!abs) return `Path '${userPath}' is outside the project root.`;
    if (!existsSync(abs)) return `Path not found: ${userPath}`;

    try {
      const result =
        await Bun.$`rg ${pattern} ${abs} --glob ${glob} --line-number --no-heading --max-count 5 --max-filesize 500K`.text();
      if (!result.trim()) return `No matches for '${pattern}' in ${userPath}`;
      const lines = result
        .split("\n")
        .filter(Boolean)
        .map((line) => line.replace(abs + "/", "").replace(this.sourceRoot + "/", ""));
      return `Matches for '${pattern}' in ${userPath} (glob: ${glob}):\n${lines.join("\n")}`;
    } catch {
      return `No matches for '${pattern}' in ${userPath}`;
    }
  }
}
