import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { resolve, relative, isAbsolute, extname } from "node:path";
import { logger } from "../logger.ts";
import { defaultVisionBaseUrl, defaultVisionModel } from "../providers/llm/createProvider.ts";

const MIME_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

const ALLOWED_MIME_SET = new Set(Object.values(MIME_TYPES));

const VISION_MAX_TOKENS = 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024; // 100 MB

const NS = "ImageVisionPlugin";

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
    visionModel = process.env.VISION_MODEL ?? defaultVisionModel(),
    baseUrl = process.env.VISION_BASE_URL ?? defaultVisionBaseUrl(),
  ) {
    this.visionModel = visionModel;
    this.baseUrl = baseUrl;

    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      logger.warn(NS, `baseUrl "${baseUrl}" uses plain HTTP with a non-local host — image data will be transmitted unencrypted.`);
    }
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

  async executeTool(name: string, args: Record<string, unknown>): Promise<string | undefined> {
    if (name === "analyze_image_url") {
      const url = args.url;
      const prompt = args.prompt;
      if (typeof url !== "string" || url.trim() === "") {
        return "Error: Missing or invalid required argument 'url'.";
      }
      return this.analyzeImageUrl(url, typeof prompt === "string" ? prompt : undefined);
    }
    if (name === "analyze_image_file") {
      const filePath = args.file_path;
      const prompt = args.prompt;
      if (typeof filePath !== "string" || filePath.trim() === "") {
        return "Error: Missing or invalid required argument 'file_path'.";
      }
      return this.analyzeImageFile(filePath, typeof prompt === "string" ? prompt : undefined);
    }
    logger.debug(NS, `executeTool called with unrecognised tool name: ${name}`);
    return undefined;
  }

  private async analyzeImageUrl(url: string, prompt?: string): Promise<string> {
    try {
      validateImageUrl(url);
    } catch (e) {
      logger.warn(NS, `URL validation failed: ${e instanceof Error ? e.message : String(e)}`);
      return `Error: ${e instanceof Error ? e.message : "Invalid URL."}`;
    }
    try {
      const res = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
        headers: {
          "User-Agent": "ImageVisionPlugin/1.0",
        },
      });
      if (!res.ok) {
        logger.warn(NS, `Image download failed: HTTP ${res.status} for ${url}`);
        return "Error: Failed to download image.";
      }

      const contentLengthHeader = res.headers.get("content-length");
      if (contentLengthHeader !== null) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (!isNaN(contentLength) && contentLength > MAX_IMAGE_BYTES) {
          logger.warn(NS, `Image too large: Content-Length ${contentLength} exceeds ${MAX_IMAGE_BYTES} bytes`);
          return `Error: Image is too large (${contentLength} bytes). Maximum allowed size is ${MAX_IMAGE_BYTES} bytes.`;
        }
      }

      const contentType = res.headers.get("content-type") ?? "";
      const mime = contentType.split(";")[0]?.trim() ?? "";
      if (!ALLOWED_MIME_SET.has(mime)) {
        logger.warn(NS, `Unsupported MIME type from URL: "${mime}"`);
        return `Error: Unsupported image type "${mime}". Supported types: ${[...ALLOWED_MIME_SET].join(", ")}`;
      }

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        logger.warn(NS, `Downloaded image too large: ${buffer.byteLength} bytes`);
        return `Error: Image is too large (${buffer.byteLength} bytes). Maximum allowed size is ${MAX_IMAGE_BYTES} bytes.`;
      }
      const base64 = Buffer.from(buffer).toString("base64");

      return this.callVisionModel(base64, mime, prompt);
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        logger.warn(NS, `Image download timed out for ${url}`);
        return "Error: Image download timed out.";
      }
      logger.error(NS, `Unexpected error downloading image from ${url}`, err);
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
      logger.warn(NS, `File path validation failed: ${e instanceof Error ? e.message : String(e)}`);
      return `Error: ${e instanceof Error ? e.message : "Invalid file path."}`;
    }
    try {
      const ext = extname(safePath).slice(1).toLowerCase();
      const mime = MIME_TYPES[ext];
      if (!mime) {
        return `Error: Unsupported file type "${ext ? `.${ext}` : "(no extension)"}". Supported types: ${Object.keys(MIME_TYPES).join(", ")}`;
      }

      const bunFile = Bun.file(safePath);
      const size = bunFile.size;
      if (size > MAX_IMAGE_BYTES) {
        logger.warn(NS, `Image file too large: ${size} bytes for ${safePath}`);
        return `Error: Image file is too large (${size} bytes). Maximum allowed size is ${MAX_IMAGE_BYTES} bytes.`;
      }

      const buffer = await bunFile.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");

      return this.callVisionModel(base64, mime, prompt);
    } catch (err) {
      logger.error(NS, `Failed to read or analyze image file: ${safePath}`, err);
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
          max_tokens: VISION_MAX_TOKENS,
        }),
      });

      if (!res.ok) {
        logger.warn(NS, `Vision model request failed: HTTP ${res.status}`);
        return "Error: Vision model request failed.";
      }

      const data: unknown = await res.json();
      const content =
        data !== null &&
        typeof data === "object" &&
        "choices" in data &&
        Array.isArray((data as { choices: unknown }).choices)
          ? ((data as { choices: Array<{ message?: { content?: unknown } }> })
              .choices[0]?.message?.content)
          : undefined;

      if (typeof content !== "string") {
        logger.warn(NS, "Vision model returned no string content", data);
        return "No response from vision model.";
      }
      return content;
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        logger.warn(NS, "Vision model request timed out.");
        return "Error: Vision model request timed out.";
      }
      logger.error(NS, "Unexpected error calling vision model.", err);
      return "Error: Failed to get vision model response.";
    }
  }
}
