import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { join, resolve, relative, isAbsolute } from "node:path";

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_READ_BYTES = 1 * 1024 * 1024; // 1 MB
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
    host.endsWith(".local")
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
    return `You can download files from the internet and read files on the local filesystem.
Use download_file to fetch a file from a URL and save it to the downloads/ directory (HTTPS only).
Use read_file to read the text content of a local file.
All local file operations are restricted to the current working directory.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "download_file",
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
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "download_file") {
      return this.downloadFile(args.url, args.destination);
    }
    if (name === "read_file") {
      return this.readFile(args.path);
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

    const filename = destination
      ? destination.replace(/[/\\]/g, "") // strip any path separators from bare filename
      : (parsed.pathname.split("/").pop() || "download");

    const savePath = validateDestination(join(DOWNLOADS_DIR, filename));

    const res = await fetch(url, {
      signal: AbortSignal.timeout(60_000),
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

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error("File exceeds the 100 MB size limit.");
    }

    await Bun.write(savePath, buffer);

    return {
      path: savePath,
      size: buffer.byteLength,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
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
}
