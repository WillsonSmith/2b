/**
 * FileSystemPlugin — full local filesystem access for the agent.
 *
 * Tools: read_file, write_file, append_file, list_directory, move_file,
 * copy_file, delete_file, delete_directory, make_directory, stat_file,
 * find_files, search_in_files, patch_file, patch_file_range.
 *
 * All paths are sandboxed to `allowedRoots` (default: process.cwd()).
 * `resolveSafe()` is the enforcement point — every private method calls it
 * before touching the filesystem.
 *
 * Mutating tools carry `permission: "per_call"` so the user is prompted
 * before each destructive operation.
 *
 * patch_file uses a two-pass approach: validate all edits against the current
 * file content first (fail fast, no partial writes), then apply in reverse
 * offset order so earlier edits don't shift the positions of later ones.
 * Falls back to a whitespace-normalized match when exact match fails.
 *
 * patch_file_range streams the file through a temp file to support large
 * files (>10 MB) without loading them fully into memory.
 *
 * search_in_files uses ripgrep if available; falls back to a built-in
 * Bun.Glob + regex scanner otherwise.
 *
 * Critical: this plugin gives the agent write access to the host filesystem.
 * The path sandbox and per_call permission on write tools are the primary
 * safeguards.
 */
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";
import { join, resolve, dirname, sep } from "node:path";
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
  open as fsOpen,
} from "node:fs/promises";

const MAX_READ_BYTES = 1 * 1024 * 1024; // 1 MB
const MAX_PAGINATED_READ_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_PATCH_BYTES = MAX_PAGINATED_READ_BYTES; // patch_file loads fully; above this use patch_file_range
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

type MatchResult =
  | { found: true; start: number; end: number; fuzzy: boolean }
  | { found: false; error: string };

/**
 * Finds the unique occurrence of `search` in `content`.
 * Returns the byte-offset range [start, end) if found exactly once.
 * If not found exactly, retries with leading whitespace stripped from each
 * line — useful when the LLM's indentation doesn't precisely match the file.
 * Returns an error if the match is ambiguous (occurs more than once).
 */
function findMatch(content: string, search: string): MatchResult {
  // Exact match
  const first = content.indexOf(search);
  if (first !== -1) {
    if (content.indexOf(search, first + 1) !== -1) {
      return { found: false, error: "Search string matches multiple locations in the file." };
    }
    return { found: true, start: first, end: first + search.length, fuzzy: false };
  }

  // Whitespace-normalized fallback: compare lines with leading whitespace stripped
  const contentLines = content.split("\n");
  const searchLines = search.split("\n");
  if (searchLines.length > contentLines.length) {
    return { found: false, error: "Search string not found in file." };
  }
  const normalizedSearch = searchLines.map((l) => l.trimStart());

  const hits: Array<{ start: number; end: number }> = [];
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const allMatch = searchLines.every((_, j) => contentLines[i + j]!.trimStart() === normalizedSearch[j]!);
    if (allMatch) {
      let startOffset = 0;
      for (let k = 0; k < i; k++) startOffset += contentLines[k]!.length + 1;
      const matchedBlock = contentLines.slice(i, i + searchLines.length).join("\n");
      hits.push({ start: startOffset, end: startOffset + matchedBlock.length });
    }
  }

  if (hits.length === 0) return { found: false, error: "Search string not found in file." };
  if (hits.length > 1) return { found: false, error: "Search string (whitespace-normalized) matches multiple locations." };
  return { found: true, ...hits[0]!, fuzzy: true };
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

  constructor(options?: FileSystemPluginOptions) {
    this.allowedRoots =
      options?.allowedRoots?.map((r) => resolve(r)) ?? [process.cwd()];
  }

  /**
   * Resolves `path` to an absolute path and verifies it falls within one of the
   * allowed roots. Throws for any path that escapes the sandbox (e.g. `../../etc`).
   * This is the single enforcement point — all private file methods must call it.
   */
  private resolveSafe(path: string): string {
    const resolved = resolve(this.allowedRoots[0]!, path);
    for (const root of this.allowedRoots) {
      if (resolved === root || resolved.startsWith(root + sep)) {
        return resolved;
      }
    }
    throw new Error("Path must be within an allowed root.");
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
      "- patch_file: Edit specific sections of an existing file using search/replace pairs. Preferred over write_file for targeted changes. Not for files over 10 MB.",
      "- patch_file_range: Replace a line range (by 1-indexed line numbers) in a file. Streams the file — use this for files over 10 MB. Call read_file with offset/limit first to find the target line numbers.",
      "IMPORTANT: Use patch_file instead of write_file when modifying existing files. Only use write_file for new files or complete rewrites. For files over 10 MB, use patch_file_range. Always call read_file first to get exact text or line numbers.",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      // Read-only tools
      {
        name: "read_file",
        description:
          "Read the text content of a file (max 1 MB). Returns content, total line count, and bytes read. Use offset and limit to page through files larger than 1 MB. Binary files are rejected with an error. When streaming large paginated files (>1 MB with offset+limit), totalLines is null and totalLinesApproximate is true.",
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
        name: "patch_file",
        permission: "per_call" as const,
        description:
          "Make targeted edits to an existing file using search/replace pairs. More efficient than write_file — only re-emits the changed sections. All edits are validated before any are applied (all-or-nothing). Tries exact match first, then whitespace-normalized match as a fallback.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute path, or path relative to the working directory.",
            },
            edits: {
              type: "array",
              description: "One or more search/replace pairs to apply.",
              items: {
                type: "object",
                properties: {
                  search: {
                    type: "string",
                    description:
                      "Exact text to find. Must appear exactly once in the file. Use read_file first to copy the text verbatim.",
                  },
                  replace: {
                    type: "string",
                    description: "Text to substitute in place of the search string.",
                  },
                },
                required: ["search", "replace"],
              },
            },
          },
          required: ["path", "edits"],
        },
      },
      {
        name: "patch_file_range",
        permission: "per_call" as const,
        description:
          "Replace a range of lines in a file by line number. Streams the file so it is safe for files over 10 MB. Use read_file with offset/limit to identify the target line numbers first. startLine and endLine are both inclusive and 1-indexed.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Absolute path, or path relative to the working directory.",
            },
            startLine: {
              type: "number",
              description: "1-indexed line number of the first line to replace (inclusive).",
            },
            endLine: {
              type: "number",
              description: "1-indexed line number of the last line to replace (inclusive). Must be >= startLine.",
            },
            newContent: {
              type: "string",
              description:
                "Replacement text. Pass an empty string to delete the line range without inserting anything.",
            },
          },
          required: ["path", "startLine", "endLine", "newContent"],
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
        case "patch_file":
          result = await withTimeout(
            this.patchFile(
              args.path as string,
              args.edits as Array<{ search: string; replace: string }>,
            ),
            FS_OP_TIMEOUT_MS,
            "patch_file",
          );
          break;
        case "patch_file_range":
          result = await withTimeout(
            this.patchFileRange(
              args.path as string,
              args.startLine as number,
              args.endLine as number,
              args.newContent as string,
            ),
            SEARCH_TIMEOUT_MS,
            "patch_file_range",
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

      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
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

  private async patchFile(
    path: string,
    edits: Array<{ search: string; replace: string }>,
  ): Promise<{
    path: string;
    editsApplied: number;
    linesAdded: number;
    linesRemoved: number;
  }> {
    if (!Array.isArray(edits) || edits.length === 0) {
      throw new Error("edits must be a non-empty array.");
    }

    const resolved = this.resolveSafe(path);
    const file = Bun.file(resolved);
    if (!(await file.exists())) throw new Error(`File not found: ${resolved}`);

    if (file.size > MAX_PATCH_BYTES) {
      throw new Error(
        `File is ${file.size} bytes, which exceeds the ${MAX_PATCH_BYTES / 1024 / 1024} MB limit for patch_file. Use patch_file_range instead.`,
      );
    }

    if (file.size > 0) {
      const sampleBuf = await file.slice(0, BINARY_SAMPLE_BYTES).arrayBuffer();
      if (isBinary(new Uint8Array(sampleBuf))) {
        throw new Error("File appears to be binary. patch_file only supports text files.");
      }
    }

    const content = await file.text();

    // Validate and locate all edits before applying any (all-or-nothing)
    const located: Array<{ start: number; end: number; replace: string; fuzzy: boolean }> = [];
    for (let i = 0; i < edits.length; i++) {
      const { search, replace } = edits[i]!;
      if (typeof search !== "string" || typeof replace !== "string") {
        throw new Error(`Edit ${i}: search and replace must be strings.`);
      }
      if (search === "") throw new Error(`Edit ${i}: search string must not be empty.`);

      const match = findMatch(content, search);
      if (!match.found) throw new Error(`Edit ${i}: ${match.error}`);
      located.push({ start: match.start, end: match.end, replace, fuzzy: match.fuzzy });
    }

    // Reject overlapping edits
    const byPosition = [...located].sort((a, b) => a.start - b.start);
    for (let i = 0; i < byPosition.length - 1; i++) {
      if (byPosition[i]!.end > byPosition[i + 1]!.start) {
        throw new Error(`Edits overlap in the file and cannot be applied together.`);
      }
    }

    // Apply in reverse order to preserve offsets
    let patched = content;
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const { start, end, replace } of [...located].sort((a, b) => b.start - a.start)) {
      const removed = patched.slice(start, end);
      linesRemoved += removed.split("\n").length;
      linesAdded += replace === "" ? 0 : replace.split("\n").length;
      patched = patched.slice(0, start) + replace + patched.slice(end);
    }

    await Bun.write(resolved, patched);
    return { path: resolved, editsApplied: edits.length, linesAdded, linesRemoved };
  }

  private async patchFileRange(
    path: string,
    startLine: number,
    endLine: number,
    newContent: string,
  ): Promise<{
    path: string;
    startLine: number;
    endLine: number;
    linesRemoved: number;
    linesAdded: number;
  }> {
    if (!Number.isInteger(startLine) || startLine < 1) {
      throw new Error("startLine must be a positive integer (1-indexed).");
    }
    if (!Number.isInteger(endLine) || endLine < startLine) {
      throw new Error(`endLine (${endLine}) must be >= startLine (${startLine}).`);
    }
    if (typeof newContent !== "string") {
      throw new Error("newContent must be a string.");
    }

    const resolved = this.resolveSafe(path);
    const file = Bun.file(resolved);
    if (!(await file.exists())) throw new Error(`File not found: ${resolved}`);

    if (file.size > 0) {
      const sampleBuf = await file.slice(0, BINARY_SAMPLE_BYTES).arrayBuffer();
      if (isBinary(new Uint8Array(sampleBuf))) {
        throw new Error("File appears to be binary. patch_file_range only supports text files.");
      }
    }

    const tmpPath = resolved + ".__patch_tmp__";
    const encoder = new TextEncoder();
    const fh = await fsOpen(tmpPath, "w");

    try {
      const stream = file.stream();
      const decoder = new TextDecoder();
      let buffer = "";
      let lineNum = 0;
      let replacementWritten = false;

      for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true });
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          lineNum++;
          const line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);

          if (lineNum < startLine || lineNum > endLine) {
            await fh.write(encoder.encode(line + "\n"));
          } else if (lineNum === startLine) {
            if (newContent !== "") {
              const toWrite = newContent.endsWith("\n") ? newContent : newContent + "\n";
              await fh.write(encoder.encode(toWrite));
            }
            replacementWritten = true;
          }
          // Lines startLine+1..endLine are dropped — replaced by newContent above
        }
      }

      // Last line with no trailing newline
      if (buffer.length > 0) {
        lineNum++;
        if (lineNum < startLine || lineNum > endLine) {
          await fh.write(encoder.encode(buffer));
        } else if (lineNum === startLine && !replacementWritten) {
          if (newContent !== "") await fh.write(encoder.encode(newContent));
          replacementWritten = true;
        }
      }

      if (!replacementWritten) {
        throw new Error(
          `startLine ${startLine} exceeds the file's line count (${lineNum}).`,
        );
      }

      await fh.close();
      await fsRename(tmpPath, resolved);
    } catch (err) {
      await fh.close().catch(() => {});
      await unlink(tmpPath).catch(() => {});
      throw err;
    }

    return {
      path: resolved,
      startLine,
      endLine,
      linesRemoved: endLine - startLine + 1,
      linesAdded: newContent === "" ? 0 : newContent.split("\n").length,
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
    const searchDir = cwd ? this.resolveSafe(cwd) : this.allowedRoots[0]!;
    const matches: string[] = [];
    for await (const file of glob.scan({
      cwd: searchDir,
      onlyFiles: true,
      dot: includeDotfiles ?? false,
    })) {
      if (Date.now() > deadline) {
        throw new Error(`find_files timed out after ${FS_OP_TIMEOUT_MS}ms`);
      }
      matches.push(join(searchDir, file));
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
    const searchDir = cwd ? this.resolveSafe(cwd) : this.allowedRoots[0]!;
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
    const flags: string[] = ["--json"];
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
      let msg: { type: string; data: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.type !== "match") continue;
      const filePath = msg.data?.path?.text;
      const lineNum = msg.data?.line_number;
      const content = (msg.data?.lines?.text ?? "").replace(/\n$/, "");
      if (typeof filePath !== "string" || typeof lineNum !== "number") continue;
      matches.push({
        file: filePath,
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
          if (regex.test(lines[i]!)) {
            matches.push({ file: join(searchDir, filePath), line: i + 1, content: lines[i]! });
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
