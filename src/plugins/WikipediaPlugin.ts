import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const API_BASE = "https://en.wikipedia.org/w/api.php";
const REST_BASE = "https://en.wikipedia.org/api/rest_v1";

export class WikipediaPlugin implements AgentPlugin {
  name = "WikipediaPlugin";

  getSystemPromptFragment(): string {
    return "You have access to Wikipedia. Use `wikipedia_search` to find articles by topic, then `wikipedia_get_article` to read the full introduction of a specific article.";
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "wikipedia_search",
        description:
          "Search Wikipedia for articles matching a query. Returns a list of article titles and snippets.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query",
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return (default 5, max 10)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "wikipedia_get_article",
        description:
          "Fetch the summary and introduction of a Wikipedia article by its exact title.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The exact Wikipedia article title (as returned by wikipedia_search)",
            },
          },
          required: ["title"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "wikipedia_search") {
      return this.search(args.query, args.limit);
    }
    if (name === "wikipedia_get_article") {
      return this.getArticle(args.title);
    }
    logger.warn(`[WikipediaPlugin] unknown tool: ${name}`);
  }

  private async search(query: string, limit?: number): Promise<any> {
    const clampedLimit = Math.min(Math.max(1, limit ?? 5), 10);
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: String(clampedLimit),
      format: "json",
      origin: "*",
    });

    logger.debug(`[WikipediaPlugin] searching: ${query}`);
    const res = await fetch(`${API_BASE}?${params}`, {
      headers: { "User-Agent": "2b-agent/1.0 (https://github.com/WillsonSmith/2b)" },
    });
    if (!res.ok) {
      throw new Error(`Wikipedia search failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const results = data?.query?.search ?? [];

    return results.map((r: any) => ({
      title: r.title,
      snippet: r.snippet.replace(/<[^>]+>/g, ""), // strip HTML tags
      wordcount: r.wordcount,
    }));
  }

  private async getArticle(title: string): Promise<any> {
    const encodedTitle = encodeURIComponent(title.replace(/ /g, "_"));
    logger.debug(`[WikipediaPlugin] fetching article: ${title}`);

    const res = await fetch(`${REST_BASE}/page/summary/${encodedTitle}`, {
      headers: { "User-Agent": "2b-agent/1.0 (https://github.com/WillsonSmith/2b)" },
    });
    if (res.status === 404) {
      return { error: `Article not found: "${title}". Try searching first.` };
    }
    if (!res.ok) {
      throw new Error(`Wikipedia fetch failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return {
      title: data.title,
      description: data.description,
      extract: data.extract,
      url: data.content_urls?.desktop?.page,
    };
  }
}
