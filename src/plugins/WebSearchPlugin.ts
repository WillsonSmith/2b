import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const DDG_INSTANT_ANSWER_URL = "https://api.duckduckgo.com/";
const MAX_QUERY_LENGTH = 500;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 100;

interface SearchResult {
  answer?: string;
  abstract?: { text: string; source: string; url: string };
  related?: Array<{ text: string; url: string }>;
  webResults?: Array<{ snippet: string; url: string }>;
  message?: string;
}

export class WebSearchPlugin implements AgentPlugin {
  name = "WebSearchPlugin";

  private readonly cache = new Map<string, { result: SearchResult; ts: number }>();

  getSystemPromptFragment(): string {
    return `You can search the web using DuckDuckGo instant answers.
Use web_search to find facts, definitions, or quick information from the internet.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "web_search",
        description:
          "Search the web using DuckDuckGo. Returns instant answers, abstracts, and related topics. Best for factual queries, definitions, and current information.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query." },
          },
          required: ["query"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "web_search") {
      try {
        return await this.search(args.query);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("WebSearchPlugin", `web_search failed: ${message}`);
        return { message };
      }
    }
    return undefined;
  }

  private async search(rawQuery: unknown): Promise<SearchResult> {
    if (typeof rawQuery !== "string" || rawQuery.trim() === "") {
      return { message: "Query must be a non-empty string." };
    }

    const query = rawQuery.length > MAX_QUERY_LENGTH
      ? rawQuery.slice(0, MAX_QUERY_LENGTH)
      : rawQuery;

    const cached = this.cache.get(query);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      logger.debug("WebSearchPlugin", `Cache hit: "${query}"`);
      return cached.result;
    }

    logger.debug("WebSearchPlugin", `Searching: "${query}"`);

    const url = new URL(DDG_INSTANT_ANSWER_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_redirect", "1");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "2b-agent/1.0 (https://github.com/WillsonSmith/2b)" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      logger.error("WebSearchPlugin", `DuckDuckGo returned ${res.status} ${res.statusText}`);
      throw new Error(`DuckDuckGo returned ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const result = this.parseResponse(data);

    if (Object.keys(result).length === 0) {
      return { message: "No instant answer found. Try a more specific query or rephrase your search." };
    }

    if (this.cache.size >= CACHE_MAX_SIZE) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(query, { result, ts: Date.now() });
    return result;
  }

  private parseResponse(data: Record<string, unknown>): SearchResult {
    const result: SearchResult = {};

    if (typeof data.Answer === "string" && data.Answer) {
      result.answer = data.Answer;
    }

    if (typeof data.AbstractText === "string" && data.AbstractText) {
      result.abstract = {
        text: String(data.AbstractText),
        source: String(data.AbstractSource ?? ""),
        url: String(data.AbstractURL ?? ""),
      };
    }

    const related: Array<{ text: string; url: string }> = [];
    if (Array.isArray(data.RelatedTopics)) {
      for (const t of data.RelatedTopics) {
        if (related.length >= 5) break;
        if (typeof t === "object" && t !== null) {
          const rec = t as Record<string, unknown>;
          if (typeof rec.Text === "string" && rec.Text) {
            related.push({ text: rec.Text, url: String(rec.FirstURL ?? "") });
          }
        }
      }
    }
    if (related.length > 0) result.related = related;

    const webResults: Array<{ snippet: string; url: string }> = [];
    if (Array.isArray(data.Results)) {
      for (const r of data.Results) {
        if (webResults.length >= 5) break;
        const rec = r as Record<string, unknown>;
        webResults.push({ snippet: String(rec.Text ?? ""), url: String(rec.FirstURL ?? "") });
      }
    }
    if (webResults.length > 0) result.webResults = webResults;

    return result;
  }
}
