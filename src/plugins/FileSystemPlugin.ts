import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import {
  readdir,
  rename as fsRename,
  copyFile as fsCopyFile,
  unlink,
  mkdir,
  stat as fsStat,
  appendFile as fsAppendFile,
} from "node:fs/promises";

const MAX_READ_BYTES = 1 * 1024 * 1024; // 1 MB
const BASE_DIR = process.cwd();

function validatePath(path: string): string {
  const resolved = resolve(BASE_DIR, path);
  const rel = relative(BASE_DIR, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path must be within the working directory.");
  }
  return resolved;
}

export class FileSystemPlugin implements AgentPlugin {
  name = "FileSystem";

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
      {
        name: "read_file",
        description:
          "Read the text content of a file (max 1 MB). Returns content, total line count, and bytes read. Use offset and limit to page through files larger than 1 MB.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file, relative to the working directory.",
            },
            offset: {
              type: "number",
              description: "1-indexed line number to start reading from. Omit to start from the beginning.",
            },
            limit: {
              type: "number",
              description: "Maximum number of lines to return. Omit to return all lines.",
            },
          },
          required: ["path"],
        },
      },
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
              description: "Path to the file, relative to the working directory.",
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
              description: "Path to the file, relative to the working directory.",
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
        name: "move_file",
        permission: "per_call" as const,
        description:
          "Move or rename a file or directory. Creates missing parent directories at the destination.",
        parameters: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description: "Current path of the file or directory, relative to the working directory.",
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
              description: "Path of the file to copy, relative to the working directory.",
            },
            destination: {
              type: "string",
              description: "Destination path for the copy, relative to the working directory.",
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
              description: "Path to the file to delete, relative to the working directory.",
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
              description: "Path to the directory to create, relative to the working directory.",
            },
          },
          required: ["path"],
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
              description: "Path to the file or directory, relative to the working directory.",
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
          },
          required: ["pattern"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "read_file":
        return this.readFile(
          args.path as string,
          args.offset as number | undefined,
          args.limit as number | undefined,
        );
      case "write_file":
        return this.writeFile(args.path as string, args.content as string);
      case "append_file":
        return this.appendFile(args.path as string, args.content as string);
      case "list_directory":
        return this.listDirectory(args.path as string | undefined);
      case "move_file":
        return this.moveFile(args.source as string, args.destination as string);
      case "copy_file":
        return this.copyFile(args.source as string, args.destination as string);
      case "delete_file":
        return this.deleteFile(args.path as string);
      case "make_directory":
        return this.makeDirectory(args.path as string);
      case "stat_file":
        return this.statFile(args.path as string);
      case "find_files":
        return this.findFiles(args.pattern as string);
      default:
        return undefined;
    }
  }

  private async readFile(
    path: string,
    offset?: number,
    limit?: number,
  ): Promise<{ path: string; content: string; totalLines: number; returnedLines: number; size: number }> {
    const resolved = validatePath(path);
    const file = Bun.file(resolved);
    const size = file.size;
    if (size > MAX_READ_BYTES) {
      throw new Error(
        `File is ${size} bytes, which exceeds the 1 MB read limit. Use offset and limit to read specific sections.`,
      );
    }
    const raw = await file.text();
    const lines = raw.split("\n");
    const totalLines = lines.length;

    const start = offset !== undefined ? Math.max(0, offset - 1) : 0;
    const sliced = limit !== undefined ? lines.slice(start, start + limit) : lines.slice(start);

    return {
      path: resolved,
      content: sliced.join("\n"),
      totalLines,
      returnedLines: sliced.length,
      size,
    };
  }

  private async writeFile(path: string, content: string): Promise<{ path: string; size: number }> {
    const resolved = validatePath(path);
    await mkdir(dirname(resolved), { recursive: true });
    const size = await Bun.write(resolved, content);
    return { path: resolved, size };
  }

  private async appendFile(path: string, content: string): Promise<{ path: string }> {
    const resolved = validatePath(path);
    await mkdir(dirname(resolved), { recursive: true });
    await fsAppendFile(resolved, content);
    return { path: resolved };
  }

  private async listDirectory(
    path?: string,
  ): Promise<{ path: string; entries: { name: string; type: "file" | "directory" | "symlink"; size?: number }[] }> {
    const resolved = validatePath(path ?? ".");
    const dirents = await readdir(resolved, { withFileTypes: true });

    const entries = await Promise.all(
      dirents.map(async (entry) => {
        const entryPath = join(resolved, entry.name);
        if (entry.isFile()) {
          const size = Bun.file(entryPath).size;
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
      path: resolved,
      entries: entries.filter((e): e is NonNullable<typeof e> => e !== null),
    };
  }

  private async moveFile(source: string, destination: string): Promise<{ from: string; to: string }> {
    const from = validatePath(source);
    const to = validatePath(destination);
    await mkdir(dirname(to), { recursive: true });
    await fsRename(from, to);
    return { from, to };
  }

  private async copyFile(source: string, destination: string): Promise<{ from: string; to: string }> {
    const from = validatePath(source);
    const to = validatePath(destination);
    await mkdir(dirname(to), { recursive: true });
    await fsCopyFile(from, to);
    return { from, to };
  }

  private async deleteFile(path: string): Promise<{ path: string }> {
    const resolved = validatePath(path);
    await unlink(resolved);
    return { path: resolved };
  }

  private async makeDirectory(path: string): Promise<{ path: string }> {
    const resolved = validatePath(path);
    await mkdir(resolved, { recursive: true });
    return { path: resolved };
  }

  private async statFile(
    path: string,
  ): Promise<{ path: string; type: "file" | "directory" | "other"; size: number; modifiedAt: string }> {
    const resolved = validatePath(path);
    const s = await fsStat(resolved);
    return {
      path: resolved,
      type: s.isFile() ? "file" : s.isDirectory() ? "directory" : "other",
      size: s.size,
      modifiedAt: s.mtime.toISOString(),
    };
  }

  private async findFiles(pattern: string): Promise<{ pattern: string; matches: string[] }> {
    const glob = new Bun.Glob(pattern);
    const matches: string[] = [];
    for await (const file of glob.scan({ cwd: BASE_DIR, onlyFiles: false, dot: true })) {
      matches.push(file);
    }
    return { pattern, matches: matches.sort() };
  }
}
