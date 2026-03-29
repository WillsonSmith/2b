import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const MAX_CONTENT_LENGTH = 8_000;
// Maximum HTML body size to buffer in memory (5 MB). Protects against large
// responses from malicious or misconfigured servers.
const MAX_HTML_BYTES = 5 * 1024 * 1024;

// Cached import promises to prevent duplicate dynamic imports under concurrency.
let jsdomImport: Promise<{ JSDOM: typeof import("jsdom").JSDOM }> | null = null;
let readabilityImport: Promise<{
  Readability: typeof import("@mozilla/readability").Readability;
}> | null = null;

export class WebReaderPlugin implements AgentPlugin {
  name = "WebReader";

  getSystemPromptFragment(): string {
    return `You can fetch and read the main content of web pages.
Use read_webpage to extract the article text, title, byline, and links from any HTTPS URL.
The response includes a links array with {text, href} objects — use these to navigate to related pages.
Only HTTPS URLs are supported.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "read_webpage",
        description:
          "Fetches a webpage and extracts the main readable content (article text, title, byline) and all links on the page. Use this to read articles, documentation, or any web page content. The links array lets you navigate to related pages.",
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

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "read_webpage") {
      return this.readWebpage(args["url"] as string);
    }
    return undefined;
  }

  // NOTE: host-based SSRF checks cannot prevent DNS rebinding attacks, where a
  // hostname initially resolves to a public IP (passing this check) and later
  // resolves to a private IP for the actual TCP connection. This is a known
  // limitation of pure JS SSRF guards.
  private static validateUrl(url: string): URL {
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

  private async readWebpage(url: string) {
    const parsedUrl = WebReaderPlugin.validateUrl(url);
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

    // Reject non-HTML responses early so callers get a meaningful error rather
    // than a silent Readability parse failure.
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html") && !contentType.includes("xml")) {
      throw new Error(
        `Unsupported content type "${contentType}". Only HTML/XML pages can be read.`,
      );
    }

    // Guard against oversized responses before buffering into memory.
    const contentLength = Number(res.headers.get("content-length") ?? NaN);
    if (!isNaN(contentLength) && contentLength > MAX_HTML_BYTES) {
      throw new Error(
        `Response too large (${contentLength} bytes). Maximum is ${MAX_HTML_BYTES} bytes.`,
      );
    }

    const html = await res.text();

    // Secondary size check for chunked/streaming responses where Content-Length
    // is absent.
    if (html.length > MAX_HTML_BYTES) {
      throw new Error(`Response body too large. Maximum is ${MAX_HTML_BYTES} bytes.`);
    }

    if (!jsdomImport) jsdomImport = import("jsdom") as Promise<{ JSDOM: typeof import("jsdom").JSDOM }>;
    if (!readabilityImport)
      readabilityImport = import("@mozilla/readability") as Promise<{
        Readability: typeof import("@mozilla/readability").Readability;
      }>;

    const [{ JSDOM }, { Readability }] = await Promise.all([jsdomImport, readabilityImport]);

    // resources is not set to "usable" intentionally — external sub-resources
    // (images, scripts, stylesheets) must not be fetched during parsing.
    const dom = new JSDOM(html, { url });

    // Extract links before Readability clones/modifies the document.
    // Only https: links are included — http: links cannot be fetched by
    // read_webpage and surfacing them could encourage plaintext navigation.
    const links: { text: string; href: string }[] = [];
    const seen = new Set<string>();
    for (const a of dom.window.document.querySelectorAll("a[href]")) {
      const href = (a as HTMLAnchorElement).href;
      const text = (a.textContent ?? "").trim();
      if (!href || !text || seen.has(href)) continue;
      try {
        const parsed = new URL(href, parsedUrl);
        if (parsed.protocol === "https:") {
          seen.add(href);
          links.push({ text, href });
        }
      } catch {
        // skip malformed hrefs
      }
    }

    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return { error: "Could not extract readable content from this page.", links };
    }

    const text = article.textContent?.replace(/\n{3,}/g, "\n\n").trim() ?? "";
    const truncated =
      text.length > MAX_CONTENT_LENGTH
        ? text.slice(0, MAX_CONTENT_LENGTH) + "\n\n[Content truncated...]"
        : text;

    return {
      title: article.title,
      byline: article.byline,
      url,
      content: truncated,
      total_length: text.length,
      links,
    };
  }
}
