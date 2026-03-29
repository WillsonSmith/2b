import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const DDGS_URL = "https://api.duckduckgo.com/";
const MAX_QUERY_LENGTH = 500;
const CACHE_TTL_MS = 60_000;

interface SearchResult {
  answer?: string;
  abstract?: { text: string; source: string; url: string };
  related?: Array<{ text: string; url: string }>;
  web_results?: Array<{ title: string; url: string }>;
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
      return this.search(args.query);
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

    const url = new URL(DDGS_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_redirect", "1");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "2b-agent/1.0 (https://github.com/WillsonSmith/2b)" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status} ${res.statusText}`);

    const data = (await res.json()) as Record<string, unknown>;

    const answer = typeof data.Answer === "string" && data.Answer ? data.Answer : undefined;

    const abstract =
      typeof data.AbstractText === "string" && data.AbstractText
        ? {
            text: String(data.AbstractText),
            source: String(data.AbstractSource ?? ""),
            url: String(data.AbstractURL ?? ""),
          }
        : undefined;

    const related = (Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [])
      .filter((t: unknown): t is Record<string, unknown> =>
        typeof t === "object" && t !== null && typeof (t as Record<string, unknown>).Text === "string" && Boolean((t as Record<string, unknown>).Text)
      )
      .slice(0, 5)
      .map((t) => ({ text: String(t.Text), url: String(t.FirstURL ?? "") }));

    const webResults = (Array.isArray(data.Results) ? data.Results : [])
      .slice(0, 5)
      .map((r: unknown) => {
        const rec = r as Record<string, unknown>;
        return { title: String(rec.Text ?? ""), url: String(rec.FirstURL ?? "") };
      });

    const result: SearchResult = {
      ...(answer !== undefined ? { answer } : {}),
      ...(abstract !== undefined ? { abstract } : {}),
      ...(related.length > 0 ? { related } : {}),
      ...(webResults.length > 0 ? { web_results: webResults } : {}),
    };

    if (Object.keys(result).length === 0) {
      return { message: "No instant answer found. Try a more specific query or rephrase your search." };
    }

    this.cache.set(query, { result, ts: Date.now() });
    return result;
  }
}
