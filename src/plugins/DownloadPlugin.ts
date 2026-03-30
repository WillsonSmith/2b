import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { join, resolve, relative, isAbsolute, basename } from "node:path";

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const DOWNLOAD_TIMEOUT_MS = 60_000;
const DOWNLOADS_DIR = join(process.cwd(), "downloads");

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
  const bareHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    bareHost === "::1" ||
    host === "0.0.0.0" ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^fc[0-9a-f]{2}:/i.test(bareHost) ||
    /^fd[0-9a-f]{2}:/i.test(bareHost) ||
    /^fe[89ab][0-9a-f]:/i.test(bareHost)
  ) {
    throw new Error("Requests to private or internal addresses are not allowed.");
  }
  return parsed;
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

export class DownloadPlugin implements AgentPlugin {
  name = "Download";

  getSystemPromptFragment(): string {
    return [
      "Use download_file to fetch a file from an HTTPS URL and save it to the downloads/ directory.",
      "Only public HTTPS URLs are supported — private and internal addresses are blocked.",
      "Files larger than 100 MB will be rejected.",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "download_file",
        permission: "per_call" as const,
        description:
          "Download a file from an HTTPS URL and save it to the downloads/ directory. Use when the user asks to fetch, download, or save a file from the internet.",
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
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "download_file") {
      return this.downloadFile(args.url as string, args.destination as string | undefined);
    }
    return undefined;
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
}
