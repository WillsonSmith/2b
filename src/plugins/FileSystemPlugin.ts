import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";
import { join, resolve, dirname, sep, relative } from "node:path";
import {
  readdir,
  rename as fsRename,
  copyFile as fsCopyFile,
  unlink,
  mkdir,
  lstat as fsLstat,
  readlink as fsReadlink,
  appendFile as fsAppendFile,
  rm as fsRm,
} from "node:fs/promises";

const MAX_READ_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_PAGINATED_READ_BYTES = 10 * 1024 * 1024; // 10 MB
const FS_OP_TIMEOUT_MS = 10_000; // 10 s
const SEARCH_TIMEOUT_MS = 30_000; // 30 s
const STAT_CONCURRENCY = 8;
const BINARY_SAMPLE_BYTES = 512;
const BINARY_NONPRINTABLE_THRESHOLD = 0.3;

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

function isBinary(sample: Uint8Array): boolean {
  let nonPrintable = 0;
  for (const byte of sample) {
    if (byte === 0x00) return true;
    if (
      !(
        byte === 0x09 ||
        byte === 0x0a ||
        byte === 0x0d ||
        (byte >= 0x20 && byte <= 0x7e)
      )
    ) {
      nonPrintable++;
    }
  }
  return (
    sample.length > 0 && nonPrintable / sample.length > BINARY_NONPRINTABLE_THRESHOLD
  );
}

export interface FileSystemPluginOptions {
  allowedRoots?: string[];
}

type DirEntry = {
  name: string;
  type: "file" | "directory" | "symlink";
  size?: number;
};

export class FileSystemPlugin implements AgentPlugin {
  name = "FileSystem";
  private readonly allowedRoots: string[];
  private readonly sessionApprovedDirs = new Set<string>();

  constructor(options?: FileSystemPluginOptions) {
    this.allowedRoots =
      options?.allowedRoots?.map((r) => resolve(r)) ?? [process.cwd()];
  }

  private resolveSafe(path: string): string {
    const resolved = resolve(this.allowedRoots[0], path);
    for (const root of this.allowedRoots) {
      if (resolved === root || resolved.startsWith(root + sep)) {
        return resolved;
      }
    }
    throw new Error("Path must be within an allowed root.");
  }

  approveDirectoryForSession(dir: string): void {
    this.sessionApprovedDirs.add(this.resolveSafe(dir));
  }

  private isDirectorySessionApproved(resolvedPath: string): boolean {
    for (const dir of this.sessionApprovedDirs) {
      if (resolvedPath === dir || resolvedPath.startsWith(dir + sep)) {
        return true;
      }
    }
    return false;
  }

  getSystemPromptFragment(): string {
    return [
      "You have direct access to the local filesystem. Paths can be absolute or relative to the working directory.",
      "- read_file: Read text content from a file (max 1 MB). Use offset and limit to page through large files. Binary files are rejected.",
      "- write_file: Write or overwrite a file with text content. Creates parent directories automatically.",
      "- append_file: Append text to the end of a file, or create it if missing.",
      "- list_directory: List files and subdirectories with names, types, and sizes.",
      "- move_file: Move or rename a file or directory.",
      "- copy_file: Copy a file to a new path.",
      "- delete_file: Permanently delete a file.",
      "- delete_directory: Recursively delete a directory and all its contents. Cannot delete an allowed root.",
      "- make_directory: Create a directory and any missing parent directories.",
      "- stat_file: Get metadata: type (file/directory/symlink/other), size, last-modified time, and symlink target if applicable.",
      "- find_files: Search for files matching a glob pattern. Dotfiles excluded by default — pass includeDotfiles: true to include .env, .gitignore, etc.",
      "- search_in_files: Search for a regex pattern across file contents. Uses ripgrep if available, with a built-in fallback.",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      // Read-only tools
      {
        name: "read_file",
        description:
          "Read the text content of a file (max 1 MB). Returns content, total line count, and bytes read. Use offset and limit to page through files larger than 1 MB. Binary files are rejected with an error.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Absolute path, or path relative to the working directory.",
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
                "Absolute path, or path relative to the working directory. Omit to list the working directory.",
            },
          },
          required: [],
        },
      },
      {
        name: "stat_file",
        description:
          "Get metadata for a file or directory: type (file/directory/symlink/other), size in bytes, last-modified timestamp. For symlinks, also returns isSymlink: true and symlinkTarget.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Absolute path, or path relative to the working directory.",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "find_files",
        description:
          "Search for files matching a glob pattern. Use ** to match any number of path segments (e.g. '**/*.ts', 'src/**/*.json', '*.md'). Dotfiles are excluded by default — pass includeDotfiles: true to include .env, .gitignore, etc. Defaults to searching from the working directory.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Glob pattern to match against file paths.",
            },
            cwd: {
              type: "string",
              description:
                "Directory to search from. Absolute path, or relative to the working directory. Omit to search from the working directory.",
            },
            limit: {
              type: "number",
              description:
                "Maximum number of results to return. Omit to return all matches.",
            },
            includeDotfiles: {
              type: "boolean",
              description:
                "Include dotfiles (e.g. .env, .gitignore) in results. Defaults to false.",
            },
          },
          required: ["pattern"],
        },
      },
      {
        name: "search_in_files",
        description:
          "Search for a regex pattern across file contents. Returns matching file paths, line numbers, and matched lines. Uses ripgrep (rg) if available, otherwise falls back to a built-in file scanner. Timeout is 30s. Binary files are skipped.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Regular expression pattern to search for.",
            },
            glob: {
              type: "string",
              description:
                "Glob pattern to filter which files are searched (e.g. '**/*.ts').",
            },
            cwd: {
              type: "string",
              description:
                "Directory to search in. Absolute path, or relative to the working directory. Omit to search from the working directory.",
            },
            maxResults: {
              type: "number",
              description:
                "Maximum number of matches to return. Defaults to 100.",
            },
            caseSensitive: {
              type: "boolean",
              description: "Use case-sensitive matching. Defaults to true.",
            },
          },
          required: ["pattern"],
        },
      },
      // Mutating tools
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
                "Absolute path, or path relative to the working directory.",
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
                "Absolute path, or path relative to the working directory.",
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
                "Absolute path, or path relative to the working directory.",
            },
            destination: {
              type: "string",
              description:
                "Absolute path, or path relative to the working directory.",
            },
          },
          required: ["source", "destination"],
        },
      },
      {
        name: "copy_file",
        permission: "per_call" as const,
        description:
          "Copy a file to a new path. Creates missing parent directories at the destination. Does not copy directories.",
        parameters: {
          type: "object",
          properties: {
            source: {
              type: "string",
              description:
                "Absolute path, or path relative to the working directory.",
            },
            destination: {
              type: "string",
              description:
                "Absolute path, or path relative to the working directory.",
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
                "Absolute path, or path relative to the working directory.",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "delete_directory",
        permission: "per_call" as const,
        description:
          "Recursively delete a directory and all its contents. This cannot be undone. Cannot delete an allowed root directory. Symlinks within are removed as links, not followed.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Absolute path, or path relative to the working directory.",
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
                "Absolute path, or path relative to the working directory.",
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
        case "delete_directory":
          result = await withTimeout(
            this.deleteDirectory(args.path as string),
            FS_OP_TIMEOUT_MS,
            "delete_directory",
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
          result = await withTimeout(
            this.findFiles(
              args.pattern as string,
              args.cwd as string | undefined,
              args.limit as number | undefined,
              args.includeDotfiles as boolean | undefined,
            ),
            FS_OP_TIMEOUT_MS,
            "find_files",
          );
          break;
        case "search_in_files":
          result = await withTimeout(
            this.searchInFiles(
              args.pattern as string,
              args.glob as string | undefined,
              args.cwd as string | undefined,
              args.maxResults as number | undefined,
              args.caseSensitive as boolean | undefined,
            ),
            SEARCH_TIMEOUT_MS,
            "search_in_files",
          );
          break;
        default:
          logger.debug("FileSystem", `unknown tool name: ${name}`);
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
    totalLines: number | null;
    returnedLines: number;
    size: number;
    totalLinesApproximate?: boolean;
  }> {
    const resolved = this.resolveSafe(path);
    const file = Bun.file(resolved);

    if (!(await file.exists())) throw new Error(`File not found: ${resolved}`);
    const size = file.size;

    if (size > MAX_PAGINATED_READ_BYTES) {
      throw new Error(
        `File is ${size} bytes, which exceeds the 10 MB read limit.`,
      );
    }

    if (offset === undefined && limit === undefined && size > MAX_READ_BYTES) {
      throw new Error(
        `File is ${size} bytes, which exceeds the 1 MB read limit. Use offset and limit to page through it.`,
      );
    }

    // Binary detection: sample first 512 bytes
    if (size > 0) {
      const sampleBuf = await file.slice(0, BINARY_SAMPLE_BYTES).arrayBuffer();
      if (isBinary(new Uint8Array(sampleBuf))) {
        throw new Error(
          "File appears to be binary. Use a different tool to handle binary content.",
        );
      }
    }

    // Streaming path for large paginated reads (avoids loading full file into memory)
    if (size > MAX_READ_BYTES && offset !== undefined && limit !== undefined) {
      const startLine = Math.max(1, offset);
      const stream = file.stream();
      const decoder = new TextDecoder();
      let buffer = "";
      let lineNum = 0;
      const collected: string[] = [];
      let done = false;

      for await (const chunk of stream) {
        if (done) break;
        buffer += decoder.decode(chunk as Uint8Array, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          lineNum++;
          const line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (lineNum >= startLine) {
            collected.push(line);
            if (collected.length >= limit) {
              done = true;
              break;
            }
          }
        }
      }

      // Handle remaining buffer (last line without trailing newline)
      if (!done && buffer.length > 0) {
        lineNum++;
        if (lineNum >= startLine && collected.length < limit) {
          collected.push(buffer);
        }
      }

      return {
        path: resolved,
        content: collected.join("\n"),
        totalLines: null,
        returnedLines: collected.length,
        size,
        totalLinesApproximate: true,
      };
    }

    // Normal path
    const raw = await file.text();
    const rawLines = raw.split("\n");
    // Strip trailing empty string produced by a file ending with \n
    const lines = rawLines.at(-1) === "" ? rawLines.slice(0, -1) : rawLines;
    const totalLines = lines.length;

    const startIdx = offset !== undefined ? Math.max(0, offset - 1) : 0;
    const sliced =
      limit !== undefined
        ? lines.slice(startIdx, startIdx + limit)
        : lines.slice(startIdx);

    return {
      path: resolved,
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
    const resolved = this.resolveSafe(path);
    await mkdir(dirname(resolved), { recursive: true });
    const size = await Bun.write(resolved, content);
    return { path: resolved, size };
  }

  private async appendFile(
    path: string,
    content: string,
  ): Promise<{ path: string; size: number }> {
    const resolved = this.resolveSafe(path);
    await mkdir(dirname(resolved), { recursive: true });
    await fsAppendFile(resolved, content);
    const size = Bun.file(resolved).size;
    return { path: resolved, size };
  }

  private async listDirectory(path?: string): Promise<{
    path: string;
    entries: DirEntry[];
  }> {
    const resolved = this.resolveSafe(path ?? ".");
    const dirents = await readdir(resolved, { withFileTypes: true });

    logger.debug("FileSystem", "list_directory stat", {
      path: resolved,
      entries: dirents.length,
    });

    const allEntries: (DirEntry | null)[] = [];
    for (let i = 0; i < dirents.length; i += STAT_CONCURRENCY) {
      const chunk = dirents.slice(i, i + STAT_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (entry): Promise<DirEntry | null> => {
          const entryPath = join(resolved, entry.name);
          if (entry.isFile()) {
            const { size } = await fsLstat(entryPath);
            return { name: entry.name, type: "file", size };
          }
          if (entry.isDirectory()) {
            return { name: entry.name, type: "directory" };
          }
          if (entry.isSymbolicLink()) {
            return { name: entry.name, type: "symlink" };
          }
          return null;
        }),
      );
      allEntries.push(...chunkResults);
    }

    return {
      path: resolved,
      entries: allEntries.filter((e): e is DirEntry => e !== null),
    };
  }

  private async moveFile(
    source: string,
    destination: string,
  ): Promise<{ from: string; to: string }> {
    const from = this.resolveSafe(source);
    const to = this.resolveSafe(destination);
    const fromStat = await fsLstat(from).catch(() => null);
    if (!fromStat) throw new Error(`Source not found: ${from}`);
    await mkdir(dirname(to), { recursive: true });
    await fsRename(from, to);
    return { from, to };
  }

  private async copyFile(
    source: string,
    destination: string,
  ): Promise<{ from: string; to: string }> {
    const from = this.resolveSafe(source);
    const to = this.resolveSafe(destination);
    const fromStat = await fsLstat(from).catch(() => null);
    if (!fromStat) throw new Error(`Source not found: ${from}`);
    await mkdir(dirname(to), { recursive: true });
    await fsCopyFile(from, to);
    return { from, to };
  }

  private async deleteFile(path: string): Promise<{ path: string }> {
    const resolved = this.resolveSafe(path);
    await unlink(resolved);
    return { path: resolved };
  }

  private async deleteDirectory(path: string): Promise<{ path: string }> {
    const resolved = this.resolveSafe(path);
    if (this.allowedRoots.some((root) => root === resolved)) {
      throw new Error(`Cannot delete an allowed root: ${resolved}`);
    }
    const s = await fsLstat(resolved).catch(() => null);
    if (!s) throw new Error(`Directory not found: ${resolved}`);
    if (!s.isDirectory()) throw new Error(`Not a directory: ${resolved}`);
    await fsRm(resolved, { recursive: true, force: false });
    return { path: resolved };
  }

  private async makeDirectory(path: string): Promise<{ path: string }> {
    const resolved = this.resolveSafe(path);
    await mkdir(resolved, { recursive: true });
    return { path: resolved };
  }

  private async statFile(path: string): Promise<{
    path: string;
    type: "file" | "directory" | "symlink" | "other";
    size: number;
    modifiedAt: string;
    isSymlink: boolean;
    symlinkTarget?: string;
  }> {
    const resolved = this.resolveSafe(path);
    const s = await fsLstat(resolved);
    const isSymlink = s.isSymbolicLink();
    let symlinkTarget: string | undefined;
    if (isSymlink) {
      symlinkTarget = await fsReadlink(resolved);
    }
    return {
      path: resolved,
      type: isSymlink
        ? "symlink"
        : s.isFile()
          ? "file"
          : s.isDirectory()
            ? "directory"
            : "other",
      size: s.size,
      modifiedAt: s.mtime.toISOString(),
      isSymlink,
      symlinkTarget,
    };
  }

  private async findFiles(
    pattern: string,
    cwd?: string,
    limit?: number,
    includeDotfiles?: boolean,
  ): Promise<{ pattern: string; matches: string[]; truncated?: boolean }> {
    const deadline = Date.now() + FS_OP_TIMEOUT_MS;
    const glob = new Bun.Glob(pattern);
    const searchDir = cwd ? this.resolveSafe(cwd) : this.allowedRoots[0];
    const matches: string[] = [];
    for await (const file of glob.scan({
      cwd: searchDir,
      onlyFiles: true,
      dot: includeDotfiles ?? false,
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

  private async searchInFiles(
    pattern: string,
    glob?: string,
    cwd?: string,
    maxResults?: number,
    caseSensitive?: boolean,
  ): Promise<{
    pattern: string;
    matches: Array<{ file: string; line: number; content: string }>;
    truncated?: boolean;
  }> {
    const searchDir = cwd ? this.resolveSafe(cwd) : this.allowedRoots[0];
    const max = maxResults ?? 100;
    const sensitive = caseSensitive ?? true;

    if (Bun.which("rg")) {
      return this.searchWithRipgrep(pattern, searchDir, glob, max, sensitive);
    }
    return this.searchWithGlob(pattern, searchDir, glob, max, sensitive);
  }

  private async searchWithRipgrep(
    pattern: string,
    searchDir: string,
    glob: string | undefined,
    max: number,
    caseSensitive: boolean,
  ): Promise<{
    pattern: string;
    matches: Array<{ file: string; line: number; content: string }>;
    truncated?: boolean;
  }> {
    const flags: string[] = [
      "--line-number",
      "--with-filename",
      "--no-heading",
      "--color=never",
    ];
    if (!caseSensitive) flags.push("--ignore-case");
    if (glob) flags.push("--glob", glob);

    let output: string;
    try {
      output = await Bun.$`rg ${flags} -- ${pattern} ${searchDir}`
        .quiet()
        .nothrow()
        .text();
    } catch {
      return this.searchWithGlob(pattern, searchDir, glob, max, caseSensitive);
    }

    const matches: Array<{ file: string; line: number; content: string }> = [];
    let truncated = false;

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const firstColon = line.indexOf(":");
      if (firstColon === -1) continue;
      const afterFile = line.slice(firstColon + 1);
      const secondColon = afterFile.indexOf(":");
      if (secondColon === -1) continue;
      const filePath = line.slice(0, firstColon);
      const lineNum = parseInt(afterFile.slice(0, secondColon), 10);
      const content = afterFile.slice(secondColon + 1);
      if (isNaN(lineNum)) continue;
      matches.push({
        file: relative(searchDir, filePath),
        line: lineNum,
        content,
      });
      if (matches.length >= max) {
        truncated = true;
        break;
      }
    }

    return { pattern, matches, ...(truncated ? { truncated: true } : {}) };
  }

  private async searchWithGlob(
    pattern: string,
    searchDir: string,
    fileGlob: string | undefined,
    max: number,
    caseSensitive: boolean,
  ): Promise<{
    pattern: string;
    matches: Array<{ file: string; line: number; content: string }>;
    truncated?: boolean;
  }> {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseSensitive ? "" : "i");
    } catch {
      throw new Error(`Invalid regex pattern: ${pattern}`);
    }

    const globPattern = fileGlob ?? "**/*";
    const scanner = new Bun.Glob(globPattern);
    const matches: Array<{ file: string; line: number; content: string }> = [];
    let truncated = false;

    for await (const filePath of scanner.scan({
      cwd: searchDir,
      onlyFiles: true,
      dot: false,
    })) {
      const abs = join(searchDir, filePath);
      const f = Bun.file(abs);
      if (!(await f.exists())) continue;

      if (f.size > 0) {
        const sampleBuf = await f.slice(0, BINARY_SAMPLE_BYTES).arrayBuffer();
        if (isBinary(new Uint8Array(sampleBuf))) continue;
      }

      try {
        const text = await f.text();
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            matches.push({ file: filePath, line: i + 1, content: lines[i] });
            if (matches.length >= max) {
              truncated = true;
              break;
            }
          }
        }
      } catch {
        // skip unreadable files
      }

      if (truncated) break;
    }

    return { pattern, matches, ...(truncated ? { truncated: true } : {}) };
  }
}
