import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { resolve, relative, isAbsolute } from "node:path";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

function validateImageUrl(url: string): void {
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
}

function validateImagePath(filePath: string): string {
  const resolved = resolve(filePath);
  const base = resolve(process.cwd());
  const rel = relative(base, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Image file must be within the application directory.");
  }
  return resolved;
}

export class ImageVisionPlugin implements AgentPlugin {
  name = "ImageVision";

  private visionModel: string;
  private baseUrl: string;

  constructor(
    visionModel = "google/gemma-3-4b",
    baseUrl = "http://127.0.0.1:1234",
  ) {
    this.visionModel = visionModel;
    this.baseUrl = baseUrl;
  }

  getSystemPromptFragment(): string {
    return `You can analyze images from URLs or local file paths.
Use analyze_image_url to describe or answer questions about an image at a web URL (HTTPS only).
Use analyze_image_file to analyze an image saved on the local filesystem.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "analyze_image_url",
        description:
          "Download an image from an HTTPS URL and analyze it using a vision model. Returns a description or answers a prompt about the image.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The full HTTPS URL of the image to analyze.",
            },
            prompt: {
              type: "string",
              description:
                "What to ask about the image. Defaults to 'Describe this image in detail.'",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "analyze_image_file",
        description:
          "Read a local image file and analyze it using a vision model. Returns a description or answers a prompt about the image.",
        parameters: {
          type: "object",
          properties: {
            file_path: {
              type: "string",
              description: "Path to the local image file (must be within the application directory).",
            },
            prompt: {
              type: "string",
              description:
                "What to ask about the image. Defaults to 'Describe this image in detail.'",
            },
          },
          required: ["file_path"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "analyze_image_url") {
      return this.analyzeImageUrl(args.url, args.prompt);
    }
    if (name === "analyze_image_file") {
      return this.analyzeImageFile(args.file_path, args.prompt);
    }
  }

  private async analyzeImageUrl(url: string, prompt?: string): Promise<string> {
    try {
      validateImageUrl(url);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : "Invalid URL."}`;
    }
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      });
      if (!res.ok) {
        return "Error: Failed to download image.";
      }

      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const mime = contentType.split(";")[0]?.trim() ?? "";
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      return this.callVisionModel(base64, mime, prompt);
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return "Error: Image download timed out.";
      }
      return "Error: Failed to analyze image.";
    }
  }

  private async analyzeImageFile(
    filePath: string,
    prompt?: string,
  ): Promise<string> {
    let safePath: string;
    try {
      safePath = validateImagePath(filePath);
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : "Invalid file path."}`;
    }
    try {
      const ext = safePath.split(".").pop()?.toLowerCase() ?? "";
      const mime = MIME_TYPES[ext];
      if (!mime) {
        return `Error: Unsupported file type ".${ext}". Supported types: ${Object.keys(MIME_TYPES).join(", ")}`;
      }

      const buffer = await Bun.file(safePath).arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      return this.callVisionModel(base64, mime, prompt);
    } catch {
      return "Error: Failed to read or analyze image file.";
    }
  }

  private async callVisionModel(
    base64: string,
    mime: string,
    prompt?: string,
  ): Promise<string> {
    const text = prompt ?? "Describe this image in detail.";

    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.visionModel,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text },
                {
                  type: "image_url",
                  image_url: { url: `data:${mime};base64,${base64}` },
                },
              ],
            },
          ],
          max_tokens: 1024,
        }),
      });

      if (!res.ok) {
        return "Error: Vision model request failed.";
      }

      const data = (await res.json()) as any;
      return (
        data.choices?.[0]?.message?.content ?? "No response from vision model."
      );
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        return "Error: Vision model request timed out.";
      }
      return "Error: Failed to get vision model response.";
    }
  }
}
