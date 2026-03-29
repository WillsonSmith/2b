import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { join, resolve, relative, isAbsolute, basename } from "node:path";
import { readdir } from "node:fs/promises";

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_READ_BYTES = 1 * 1024 * 1024; // 1 MB
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DOWNLOADS_DIR = join(process.cwd(), "downloads");
const BASE_DIR = process.cwd();

function validateUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL format.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed.");
  }
  const host = parsed.hostname.toLowerCase();
  // Strip IPv6 brackets for bare comparison
  const bareHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0" ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    // Private / link-local IPv6 ranges: fc00::/7 (fc/fd), fe80::/10, loopback
    /^fc[0-9a-f]{2}:/i.test(bareHost) ||
    /^fd[0-9a-f]{2}:/i.test(bareHost) ||
    /^fe[89ab][0-9a-f]:/i.test(bareHost)
  ) {
    throw new Error("Requests to private or internal addresses are not allowed.");
  }
  return parsed;
}

function validatePath(path: string): string {
  const resolved = resolve(BASE_DIR, path);
  const rel = relative(BASE_DIR, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path must be within the working directory.");
  }
  return resolved;
}

function validateDestination(destination: string): string {
  const resolved = resolve(destination);
  const base = resolve(DOWNLOADS_DIR);
  const rel = relative(base, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Download destination must be within the downloads directory.");
  }
  return resolved;
}

export class FileIOPlugin implements AgentPlugin {
  name = "FileIO";

  getSystemPromptFragment(): string {
    return [
      "You can download files from the internet and read/write files on the local filesystem.",
      "Use download_file to fetch a file from a URL and save it to the downloads/ directory (HTTPS only).",
      "Use read_file to read the text content of a local file.",
      "Use write_file to write or overwrite text content to a local file (creates parent directories as needed).",
      "Use list_directory to list the contents of a local directory.",
      "All local file operations are restricted to the current working directory.",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "download_file",
        permission: "once" as const,
        description:
          "Download a file from an HTTPS URL and write it to the downloads/ directory. Use this when the user asks to download, save, or store a file from the internet.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The full HTTPS URL of the file to download.",
            },
            destination: {
              type: "string",
              description:
                "Filename (not a path) to save as inside downloads/. If omitted, uses the filename from the URL.",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "read_file",
        description:
          "Read the text content of a local file. Use this when the user asks to read, view, or inspect a file on disk. Limited to 1 MB.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file, relative to the working directory.",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "write_file",
        permission: "always" as const,
        description:
          "Write text content to a local file, creating parent directories as needed. Use this when the user asks to save, create, or overwrite a file on disk.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the file, relative to the working directory.",
            },
            content: {
              type: "string",
              description: "Text content to write to the file.",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "list_directory",
        description:
          "List the contents of a local directory. Use this when the user asks to browse, explore, or list files in a folder.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Path to the directory, relative to the working directory. Defaults to the working directory if omitted.",
            },
          },
          required: [],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "download_file":
        return this.downloadFile(args.url as string, args.destination as string | undefined);
      case "read_file":
        return this.readFile(args.path as string);
      case "write_file":
        return this.writeFile(args.path as string, args.content as string);
      case "list_directory":
        return this.listDirectory(args.path as string | undefined);
      default:
        return undefined;
    }
  }

  private async downloadFile(
    url: string,
    destination?: string,
  ): Promise<{ path: string; size: number; contentType: string }> {
    let parsed: URL;
    try {
      parsed = validateUrl(url);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Invalid URL.");
    }

    const rawFilename = destination
      ? basename(destination)
      : (parsed.pathname.split("/").pop() || "download");
    const filename = rawFilename || "download";

    const savePath = validateDestination(join(DOWNLOADS_DIR, filename));

    const res = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    });

    if (!res.ok) {
      throw new Error(`Download failed: server returned ${res.status}.`);
    }

    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_DOWNLOAD_BYTES) {
      throw new Error("File exceeds the 100 MB size limit.");
    }

    // Stream the response body directly to disk to avoid buffering 100 MB in JS heap.
    const contentType = res.headers.get("content-type") ?? "application/octet-stream";
    const bytesWritten = await Bun.write(savePath, res);

    if (bytesWritten > MAX_DOWNLOAD_BYTES) {
      throw new Error("File exceeds the 100 MB size limit.");
    }

    return {
      path: savePath,
      size: bytesWritten,
      contentType,
    };
  }

  private async readFile(path: string): Promise<{ path: string; content: string; size: number }> {
    const resolved = validatePath(path);
    const file = Bun.file(resolved);
    const size = file.size;
    if (size > MAX_READ_BYTES) {
      throw new Error(`File exceeds the 1 MB read limit (${size} bytes).`);
    }
    const content = await file.text();
    return { path: resolved, content, size };
  }

  private async writeFile(path: string, content: string): Promise<{ path: string; size: number }> {
    const resolved = validatePath(path);
    const size = await Bun.write(resolved, content);
    return { path: resolved, size };
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
}
