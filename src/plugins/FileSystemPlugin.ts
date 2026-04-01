import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import {
  readdir,
  rename as fsRename,
  copyFile as fsCopyFile,
  unlink,
  mkdir,
  stat as fsStat,
  lstat as fsLstat,
  realpath as fsRealpath,
  appendFile as fsAppendFile,
} from "node:fs/promises";

const MAX_READ_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_PAGINATED_READ_BYTES = 10 * 1024 * 1024; // 10 MB
const FS_OP_TIMEOUT_MS = 10_000; // 10 s

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

export class FileSystemPlugin implements AgentPlugin {
  name = "FileSystem";
  private readonly baseDir: string;

  constructor() {
    this.baseDir = process.cwd();
  }

  private validatePath(path: string): string {
    const resolved = resolve(this.baseDir, path);
    const rel = relative(this.baseDir, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Path must be within the working directory.");
    }
    return resolved;
  }

  getSystemPromptFragment(): string {
    return [
      "You have direct access to the local filesystem within the working directory.",
      "- read_file: Read text content from a file (max 1 MB). Use offset and limit to page through large files.",
      "- write_file: Write or overwrite a file with text content. Creates parent directories automatically.",
      "- append_file: Append text to the end of a file, or create it if missing.",
      "- list_directory: List files and subdirectories with names, types, and sizes.",
      "- move_file: Move or rename a file or directory.",
      "- copy_file: Copy a file to a new path.",
      "- delete_file: Permanently delete a file.",
      "- make_directory: Create a directory and any missing parent directories.",
      "- stat_file: Get metadata for a file or directory: type, size, and last-modified time.",
      "- find_files: Search for files matching a glob pattern (e.g. '**/*.ts', 'src/**/*.json').",
      "All paths are relative to the working directory and cannot escape it.",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      // Read-only tools (no permission field — approved implicitly)
      {
        name: "read_file",
        description:
          "Read the text content of a file (max 1 MB). Returns content, total line count, and bytes read. Use offset and limit to page through files larger than 1 MB.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the file, relative to the working directory.",
            },
            offset: {
              type: "number",
              description:
                "1-indexed line number to start reading from. Omit to start from the beginning.",
            },
            limit: {
              type: "number",
              description:
                "Maximum number of lines to return. Omit to return all lines.",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "list_directory",
        description:
          "List the contents of a directory. Returns each entry's name, type (file/directory/symlink), and size for files. Defaults to the working directory.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the directory, relative to the working directory. Omit to list the working directory.",
            },
          },
          required: [],
        },
      },
      {
        name: "stat_file",
        description:
          "Get metadata for a file or directory: type (file/directory/other), size in bytes, and last-modified timestamp.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the file or directory, relative to the working directory.",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "find_files",
        description:
          "Search for files matching a glob pattern within the working directory. Use ** to match any number of path segments (e.g. '**/*.ts', 'src/**/*.json', '*.md').",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Glob pattern to match against file paths.",
            },
            limit: {
              type: "number",
              description:
                "Maximum number of results to return. Omit to return all matches.",
            },
          },
          required: ["pattern"],
        },
      },
      // Mutating tools (permission: "per_call" — user approves each invocation)
      {
        name: "write_file",
        permission: "per_call" as const,
        description:
          "Write text content to a file, overwriting it if it exists. Creates parent directories as needed.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the file, relative to the working directory.",
            },
            content: {
              type: "string",
              description: "Text content to write.",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "append_file",
        permission: "per_call" as const,
        description:
          "Append text to the end of a file. Creates the file (and any missing parent directories) if it does not exist.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the file, relative to the working directory.",
            },
            content: {
              type: "string",
              description: "Text to append.",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "move_file",
        permission: "per_call" as const,
        description:
          "Move or rename a file or directory. Creates missing parent directories at the destination.",
        parameters: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description:
                "Current path of the file or directory, relative to the working directory.",
            },
            destination: {
              type: "string",
              description: "New path, relative to the working directory.",
            },
          },
          required: ["source", "destination"],
        },
      },
      {
        name: "copy_file",
        permission: "per_call" as const,
        description:
          "Copy a file to a new path within the working directory. Creates missing parent directories at the destination. Does not copy directories.",
        parameters: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description:
                "Path of the file to copy, relative to the working directory.",
            },
            destination: {
              type: "string",
              description:
                "Destination path for the copy, relative to the working directory.",
            },
          },
          required: ["source", "destination"],
        },
      },
      {
        name: "delete_file",
        permission: "per_call" as const,
        description:
          "Permanently delete a file. This cannot be undone. Does not delete directories.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the file to delete, relative to the working directory.",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "make_directory",
        permission: "per_call" as const,
        description: "Create a directory and any missing parent directories.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Path to the directory to create, relative to the working directory.",
            },
          },
          required: ["path"],
        },
      },
    ];
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    // Log args without potentially large content fields
    const { content: _content, ...logArgs } = args as Record<
      string,
      unknown
    > & { content?: unknown };
    logger.debug("FileSystem", `${name} start`, logArgs);
    const start = Date.now();
    try {
      let result: unknown;
      switch (name) {
        case "read_file":
          result = await withTimeout(
            this.readFile(
              args.path as string,
              args.offset as number | undefined,
              args.limit as number | undefined,
            ),
            FS_OP_TIMEOUT_MS,
            "read_file",
          );
          break;
        case "write_file":
          result = await withTimeout(
            this.writeFile(args.path as string, args.content as string),
            FS_OP_TIMEOUT_MS,
            "write_file",
          );
          break;
        case "append_file":
          result = await withTimeout(
            this.appendFile(args.path as string, args.content as string),
            FS_OP_TIMEOUT_MS,
            "append_file",
          );
          break;
        case "list_directory":
          result = await withTimeout(
            this.listDirectory(args.path as string | undefined),
            FS_OP_TIMEOUT_MS,
            "list_directory",
          );
          break;
        case "move_file":
          result = await withTimeout(
            this.moveFile(args.source as string, args.destination as string),
            FS_OP_TIMEOUT_MS,
            "move_file",
          );
          break;
        case "copy_file":
          result = await withTimeout(
            this.copyFile(args.source as string, args.destination as string),
            FS_OP_TIMEOUT_MS,
            "copy_file",
          );
          break;
        case "delete_file":
          result = await withTimeout(
            this.deleteFile(args.path as string),
            FS_OP_TIMEOUT_MS,
            "delete_file",
          );
          break;
        case "make_directory":
          result = await withTimeout(
            this.makeDirectory(args.path as string),
            FS_OP_TIMEOUT_MS,
            "make_directory",
          );
          break;
        case "stat_file":
          result = await withTimeout(
            this.statFile(args.path as string),
            FS_OP_TIMEOUT_MS,
            "stat_file",
          );
          break;
        case "find_files":
          result = await this.findFiles(
            args.pattern as string,
            args.limit as number | undefined,
          );
          break;
        default:
          result = undefined;
          break;
      }
      logger.debug("FileSystem", `${name} done`, {
        elapsed: `${Date.now() - start}ms`,
      });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.debug("FileSystem", `${name} error`, {
        elapsed: `${Date.now() - start}ms`,
        error: msg,
      });
      throw new Error(`${name} failed: ${msg}`);
    }
  }

  private async readFile(
    path: string,
    offset?: number,
    limit?: number,
  ): Promise<{
    path: string;
    content: string;
    totalLines: number;
    returnedLines: number;
    size: number;
  }> {
    const resolved = this.validatePath(path);
    const file = Bun.file(resolved);
    const size = file.size;

    // Hard cap: files over 10 MB are never loaded into memory
    if (size > MAX_PAGINATED_READ_BYTES) {
      throw new Error(
        `File is ${size} bytes, which exceeds the 10 MB read limit.`,
      );
    }

    // Without pagination, apply the tighter 1 MB guard and suggest paging
    if (offset === undefined && limit === undefined && size > MAX_READ_BYTES) {
      throw new Error(
        `File is ${size} bytes, which exceeds the 1 MB read limit. Use offset and limit to page through it.`,
      );
    }

    const raw = await file.text();
    const lines = raw.split("\n");
    const totalLines = lines.length;

    const start = offset !== undefined ? Math.max(0, offset - 1) : 0;
    const sliced =
      limit !== undefined
        ? lines.slice(start, start + limit)
        : lines.slice(start);

    return {
      path: relative(this.baseDir, resolved),
      content: sliced.join("\n"),
      totalLines,
      returnedLines: sliced.length,
      size,
    };
  }

  private async writeFile(
    path: string,
    content: string,
  ): Promise<{ path: string; size: number }> {
    const resolved = this.validatePath(path);
    await mkdir(dirname(resolved), { recursive: true });
    const size = await Bun.write(resolved, content);
    return { path: relative(this.baseDir, resolved), size };
  }

  private async appendFile(
    path: string,
    content: string,
  ): Promise<{ path: string; size: number }> {
    const resolved = this.validatePath(path);
    await mkdir(dirname(resolved), { recursive: true });
    await fsAppendFile(resolved, content);
    const size = Bun.file(resolved).size;
    return { path: relative(this.baseDir, resolved), size };
  }

  private async listDirectory(
    path?: string,
  ): Promise<{
    path: string;
    entries: {
      name: string;
      type: "file" | "directory" | "symlink";
      size?: number;
    }[];
  }> {
    const resolved = this.validatePath(path ?? ".");
    const dirents = await readdir(resolved, { withFileTypes: true });

    logger.debug("FileSystem", "list_directory stat", {
      path: relative(this.baseDir, resolved) || ".",
      entries: dirents.length,
    });

    const entries = await Promise.all(
      dirents.map(async (entry) => {
        const entryPath = join(resolved, entry.name);
        if (entry.isFile()) {
          const { size } = await fsStat(entryPath);
          return { name: entry.name, type: "file" as const, size };
        }
        if (entry.isDirectory()) {
          return { name: entry.name, type: "directory" as const };
        }
        if (entry.isSymbolicLink()) {
          return { name: entry.name, type: "symlink" as const };
        }
        return null;
      }),
    );

    return {
      path: relative(this.baseDir, resolved) || ".",
      entries: entries.filter((e): e is NonNullable<typeof e> => e !== null),
    };
  }

  private async moveFile(
    source: string,
    destination: string,
  ): Promise<{ from: string; to: string }> {
    const from = this.validatePath(source);
    const to = this.validatePath(destination);
    await mkdir(dirname(to), { recursive: true });
    await fsRename(from, to);
    return {
      from: relative(this.baseDir, from),
      to: relative(this.baseDir, to),
    };
  }

  private async copyFile(
    source: string,
    destination: string,
  ): Promise<{ from: string; to: string }> {
    const from = this.validatePath(source);
    const to = this.validatePath(destination);
    await mkdir(dirname(to), { recursive: true });
    await fsCopyFile(from, to);
    return {
      from: relative(this.baseDir, from),
      to: relative(this.baseDir, to),
    };
  }

  private async deleteFile(path: string): Promise<{ path: string }> {
    const resolved = this.validatePath(path);
    // Verify that symlink targets also reside within baseDir before deleting
    const lstatResult = await fsLstat(resolved);
    if (lstatResult.isSymbolicLink()) {
      const realTarget = await fsRealpath(resolved);
      const rel = relative(this.baseDir, realTarget);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(
          "Refusing to delete: symlink target is outside the working directory.",
        );
      }
    }
    await unlink(resolved);
    return { path: relative(this.baseDir, resolved) };
  }

  private async makeDirectory(path: string): Promise<{ path: string }> {
    const resolved = this.validatePath(path);
    await mkdir(resolved, { recursive: true });
    return { path: relative(this.baseDir, resolved) };
  }

  private async statFile(
    path: string,
  ): Promise<{
    path: string;
    type: "file" | "directory" | "other";
    size: number;
    modifiedAt: string;
  }> {
    const resolved = this.validatePath(path);
    const s = await fsStat(resolved);
    return {
      path: relative(this.baseDir, resolved),
      type: s.isFile() ? "file" : s.isDirectory() ? "directory" : "other",
      size: s.size,
      modifiedAt: s.mtime.toISOString(),
    };
  }

  private async findFiles(
    pattern: string,
    limit?: number,
  ): Promise<{ pattern: string; matches: string[]; truncated?: boolean }> {
    const deadline = Date.now() + FS_OP_TIMEOUT_MS;
    const glob = new Bun.Glob(pattern);
    const matches: string[] = [];
    for await (const file of glob.scan({
      cwd: this.baseDir,
      onlyFiles: true,
      dot: true,
    })) {
      if (Date.now() > deadline) {
        throw new Error(`find_files timed out after ${FS_OP_TIMEOUT_MS}ms`);
      }
      matches.push(file);
      if (limit !== undefined && matches.length >= limit) {
        return { pattern, matches: matches.sort(), truncated: true };
      }
    }
    return { pattern, matches: matches.sort() };
  }
}
