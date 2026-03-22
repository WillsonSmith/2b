import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const DDGS_URL = "https://api.duckduckgo.com/";

export class WebSearchPlugin implements AgentPlugin {
  name = "WebSearch";

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

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "web_search") {
      return this.search(args.query);
    }
  }

  private async search(query: string) {
    logger.debug("WebSearch", `Searching: "${query}"`);

    const url = new URL(DDGS_URL);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_redirect", "1");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "2b-agent/1.0" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) throw new Error(`DuckDuckGo returned ${res.status}`);

    const data = (await res.json()) as any;
    const results: Record<string, any> = {};

    if (data.Answer) {
      results.answer = data.Answer;
    }

    if (data.AbstractText) {
      results.abstract = {
        text: data.AbstractText,
        source: data.AbstractSource,
        url: data.AbstractURL,
      };
    }

    const related = (data.RelatedTopics ?? [])
      .filter((t: any) => t.Text)
      .slice(0, 5)
      .map((t: any) => ({ text: t.Text, url: t.FirstURL }));

    if (related.length > 0) results.related = related;

    const webResults = (data.Results ?? [])
      .slice(0, 5)
      .map((r: any) => ({ title: r.Text, url: r.FirstURL }));

    if (webResults.length > 0) results.web_results = webResults;

    if (Object.keys(results).length === 0) {
      return {
        message:
          "No instant answer found. Try a more specific query or rephrase your search.",
      };
    }

    return results;
  }
}
