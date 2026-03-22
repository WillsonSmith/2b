import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

// Lazy imports to avoid startup overhead
let Readability: any = null;
let JSDOM: any = null;

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
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new Error("Requests to private or internal addresses are not allowed.");
  }
  return parsed;
}

export class WebReaderPlugin implements AgentPlugin {
  name = "WebReader";

  getSystemPromptFragment(): string {
    return `You can fetch and read the main content of web pages.
Use read_webpage to extract the article text, title, and byline from any HTTPS URL.
Only HTTPS URLs are supported.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "read_webpage",
        description:
          "Fetches a webpage and extracts the main readable content (article text, title, byline). Use this to read articles, documentation, or any web page content.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The HTTPS URL of the webpage to read.",
            },
          },
          required: ["url"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "read_webpage") {
      return this.readWebpage(args.url);
    }
  }

  private async readWebpage(url: string) {
    validateUrl(url);
    logger.debug("WebReader", `Fetching: ${url}`);

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) throw new Error(`Failed to fetch page: ${res.status}`);

    const html = await res.text();

    if (!JSDOM) JSDOM = (await import("jsdom")).JSDOM;
    if (!Readability) Readability = (await import("@mozilla/readability")).Readability;

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return { error: "Could not extract readable content from this page." };
    }

    const text = article.textContent?.replace(/\n{3,}/g, "\n\n").trim() ?? "";
    const truncated =
      text.length > 8000 ? text.slice(0, 8000) + "\n\n[Content truncated...]" : text;

    return {
      title: article.title,
      byline: article.byline,
      url,
      content: truncated,
      total_length: text.length,
    };
  }
}
