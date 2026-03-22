import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
  author?: string;
  guid?: string;
}

interface RSSFeed {
  title: string;
  link: string;
  description: string;
  items: RSSItem[];
}

function extractTag(xml: string, tag: string): string {
  const cdataMatch = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i").exec(xml);
  if (cdataMatch) return cdataMatch[1].trim();
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? match[1].trim() : "";
}

function extractAttrOrTag(xml: string, tag: string, attr: string, attrValue: string, resultAttr: string): string {
  const match = new RegExp(`<${tag}[^>]*${attr}=["']${attrValue}["'][^>]*${resultAttr}=["']([^"']+)["']`, "i").exec(xml) ||
    new RegExp(`<${tag}[^>]*${resultAttr}=["']([^"']+)["'][^>]*${attr}=["']${attrValue}["']`, "i").exec(xml);
  return match ? match[1] : "";
}

function parseRSSItems(channel: string, limit: number): RSSItem[] {
  const items: RSSItem[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(channel)) !== null && items.length < limit) {
    const raw = match[1];
    items.push({
      title: extractTag(raw, "title"),
      link: extractTag(raw, "link") || extractTag(raw, "guid"),
      description: extractTag(raw, "description"),
      pubDate: extractTag(raw, "pubDate") || extractTag(raw, "dc:date"),
      author: extractTag(raw, "author") || extractTag(raw, "dc:creator"),
      guid: extractTag(raw, "guid"),
    });
  }
  return items;
}

function parseAtomEntries(xml: string, limit: number): RSSItem[] {
  const items: RSSItem[] = [];
  const entryPattern = /<entry>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(xml)) !== null && items.length < limit) {
    const raw = match[1];
    const link = extractAttrOrTag(raw, "link", "rel", "alternate", "href") ||
      extractAttrOrTag(raw, "link", "type", "text/html", "href") ||
      (() => { const m = /<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(raw); return m ? m[1] : ""; })();
    items.push({
      title: extractTag(raw, "title"),
      link,
      description: extractTag(raw, "summary") || extractTag(raw, "content"),
      pubDate: extractTag(raw, "published") || extractTag(raw, "updated"),
      author: extractTag(raw, "name") || extractTag(raw, "author"),
      guid: extractTag(raw, "id"),
    });
  }
  return items;
}

function parseFeed(xml: string, limit: number): RSSFeed {
  const isAtom = /<feed[^>]*xmlns[^>]*atom/i.test(xml) || /<feed>/i.test(xml);

  if (isAtom) {
    const title = extractTag(xml, "title");
    const link = extractAttrOrTag(xml, "link", "rel", "alternate", "href") ||
      (() => { const m = /<link[^>]*href=["']([^"']+)["']/i.exec(xml); return m ? m[1] : ""; })();
    const description = extractTag(xml, "subtitle");
    const items = parseAtomEntries(xml, limit);
    return { title, link, description, items };
  }

  const channelMatch = /<channel>([\s\S]*)<\/channel>/i.exec(xml);
  const channel = channelMatch ? channelMatch[1] : xml;

  return {
    title: extractTag(channel, "title"),
    link: extractTag(channel, "link"),
    description: extractTag(channel, "description"),
    items: parseRSSItems(channel, limit),
  };
}

export class RSSPlugin implements AgentPlugin {
  name = "RSSPlugin";

  getSystemPromptFragment(): string {
    return `You can fetch and read RSS and Atom feeds. Use fetch_rss_feed to retrieve recent articles or entries from any RSS/Atom feed URL. Results include title, link, description, publication date, and author for each item.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "fetch_rss_feed",
        description: "Fetch and parse an RSS or Atom feed, returning recent articles/entries. Use this when the user asks to check a news feed, blog, podcast, or any URL that is an RSS or Atom feed.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The RSS or Atom feed URL (must be HTTPS)",
            },
            limit: {
              type: "number",
              description: "Maximum number of items to return (default: 10, max: 50)",
            },
          },
          required: ["url"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "fetch_rss_feed") {
      return this.fetchFeed(args.url, args.limit ?? 10);
    }
  }

  private async fetchFeed(url: string, limit: number): Promise<RSSFeed | { error: string }> {
    if (!url.startsWith("https://")) {
      return { error: "Only HTTPS feed URLs are supported" };
    }

    const clampedLimit = Math.min(Math.max(1, limit), 50);

    try {
      logger.info(`[RSSPlugin] Fetching feed: ${url}`);
      const response = await fetch(url, {
        headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        return { error: `HTTP ${response.status}: ${response.statusText}` };
      }

      const xml = await response.text();
      const feed = parseFeed(xml, clampedLimit);
      logger.info(`[RSSPlugin] Parsed ${feed.items.length} items from "${feed.title}"`);
      return feed;
    } catch (err: any) {
      logger.error(`[RSSPlugin] Failed to fetch feed: ${err?.message}`);
      return { error: err?.message ?? "Unknown error fetching feed" };
    }
  }
}
