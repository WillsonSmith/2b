import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const API_BASE = "https://en.wikipedia.org/w/api.php";
const REST_BASE = "https://en.wikipedia.org/api/rest_v1";
const USER_AGENT = "2b-agent/1.0 (https://github.com/WillsonSmith/2b)";

const MAX_SECTION_CHARS = 8_000;
const DEFAULT_SECTION_CHARS = 4_000;
const DEFAULT_LINKS_LIMIT = 20;
const MAX_LINKS_LIMIT = 50;
const CACHE_TTL_MS = 30_000;

interface MobileSectionEntry {
  id: number;
  toclevel?: number;
  line?: string;
  anchor?: string;
  text?: string;
}

interface MobileSectionsResponse {
  lead: { sections: MobileSectionEntry[] };
  remaining: { sections: MobileSectionEntry[] };
}

interface WikiLink {
  text: string;
  title: string;
}

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

// Decodes the six most common named HTML entities plus &#39;.
// Numeric entities (e.g. &#8216;, &#160;) and less-common named entities are
// intentionally left as-is — they appear rarely in Wikipedia prose and adding
// a full decode table would pull in a dependency for marginal benefit.
function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
}

function cleanSectionText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\[[^\]]{0,30}\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Extracts internal Wikipedia links from raw HTML using a regex over the
// title attribute. The inner-text capture ([^<]+) only matches plain text
// directly inside the <a> tag — links whose visible text is wrapped in a
// child element (e.g. <a title="Foo"><b>Bold</b></a>) will be silently
// skipped. This is an acceptable trade-off for the Wikipedia mobile API,
// where most anchors contain plain text.
function extractLinks(html: string): WikiLink[] {
  const pattern = /<a[^>]+title="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  const seen = new Set<string>();
  const links: WikiLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const title = match[1]!;
    const text = match[2]!.trim();
    if (!seen.has(title)) {
      seen.add(title);
      links.push({ text, title });
    }
  }
  return links;
}

export class WikipediaPlugin implements AgentPlugin {
  name = "WikipediaPlugin";

  private readonly sectionCache = new Map<
    string,
    { data: MobileSectionsResponse; expiresAt: number }
  >();

  getSystemPromptFragment(): string {
    return "You have access to Wikipedia. Use `wikipedia_search` to find articles, `wikipedia_get_article` for a short summary, `wikipedia_list_sections` to see an article's table of contents, `wikipedia_get_section` to read any specific section, and `wikipedia_get_links` to find articles that a page links to so you can follow up on related topics. For long articles, always list sections first and fetch only the sections you need.";
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
          "Fetch the short summary of a Wikipedia article by its exact title. Returns the first paragraph and description only. For the full article text, use wikipedia_list_sections then wikipedia_get_section. To find related articles, use wikipedia_get_links.",
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
      {
        name: "wikipedia_list_sections",
        description:
          "Get the table of contents for a Wikipedia article — section titles, indices, and depth levels. Call this before wikipedia_get_section to find which sections are relevant.",
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
      {
        name: "wikipedia_get_section",
        description:
          "Fetch the plain-text content of one specific section of a Wikipedia article by its section index (as returned by wikipedia_list_sections).",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The exact Wikipedia article title",
            },
            section_index: {
              type: "number",
              description:
                "The section index from wikipedia_list_sections (0 = introduction, 1 = first body section, etc.)",
            },
            max_chars: {
              type: "number",
              description: `Maximum characters to return (default ${DEFAULT_SECTION_CHARS}, max ${MAX_SECTION_CHARS})`,
            },
          },
          required: ["title", "section_index"],
        },
      },
      {
        name: "wikipedia_get_links",
        description:
          "Extract internal Wikipedia links from an article or a specific section. Returns link text and article titles usable directly with wikipedia_get_article. Use this to discover and follow related topics.",
        parameters: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "The exact Wikipedia article title",
            },
            section_index: {
              type: "number",
              description:
                "If provided, return links from that section only. If omitted, return links from the full article.",
            },
            limit: {
              type: "number",
              description: `Maximum number of links to return after deduplication (default ${DEFAULT_LINKS_LIMIT}, max ${MAX_LINKS_LIMIT})`,
            },
          },
          required: ["title"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "wikipedia_search") {
      return this.search(args.query as string, args.limit as number | undefined);
    }
    if (name === "wikipedia_get_article") {
      return this.getArticle(args.title as string);
    }
    if (name === "wikipedia_list_sections") {
      return this.listSections(args.title as string);
    }
    if (name === "wikipedia_get_section") {
      return this.getSection(
        args.title as string,
        Number(args.section_index),
        args.max_chars !== undefined ? Number(args.max_chars) : undefined,
      );
    }
    if (name === "wikipedia_get_links") {
      return this.getLinks(
        args.title as string,
        args.section_index !== undefined ? Number(args.section_index) : undefined,
        args.limit !== undefined ? Number(args.limit) : undefined,
      );
    }
    logger.warn("WikipediaPlugin", `unknown tool: ${name}`);
  }

  private async search(query: string, limit?: number): Promise<unknown> {
    const clampedLimit = Math.min(Math.max(1, limit ?? 5), 10);
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: query,
      srlimit: String(clampedLimit),
      format: "json",
    });

    logger.debug("WikipediaPlugin", `searching: ${query}`);
    const res = await fetch(`${API_BASE}?${params}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      throw new Error(`Wikipedia search failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const results = data?.query?.search ?? [];

    return results.map((r: { title: string; snippet: string; wordcount: number }) => ({
      title: r.title,
      snippet: r.snippet.replace(/<[^>]+>/g, ""),
      wordcount: r.wordcount,
    }));
  }

  private async getArticle(title: string): Promise<unknown> {
    const encodedTitle = encodeURIComponent(title.replace(/ /g, "_"));
    logger.debug("WikipediaPlugin", `fetching article summary: ${title}`);

    const res = await fetch(`${REST_BASE}/page/summary/${encodedTitle}`, {
      headers: { "User-Agent": USER_AGENT },
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

  private async fetchSections(title: string): Promise<MobileSectionsResponse> {
    const encodedTitle = encodeURIComponent(title.replace(/ /g, "_"));
    const cached = this.sectionCache.get(encodedTitle);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    logger.debug("WikipediaPlugin", `fetching sections: ${title}`);
    const res = await fetch(`${REST_BASE}/page/mobile-sections/${encodedTitle}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.status === 404) {
      throw new NotFoundError(`Article not found: "${title}". Try searching first.`);
    }
    if (!res.ok) {
      throw new Error(`Wikipedia fetch failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as MobileSectionsResponse;
    this.sectionCache.set(encodedTitle, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  }

  private async listSections(title: string): Promise<unknown> {
    let data: MobileSectionsResponse;
    try {
      data = await this.fetchSections(title);
    } catch (e) {
      if (e instanceof NotFoundError) return { error: e.message };
      throw e;
    }

    // `index` mirrors the API's `id` field (not positional array index).
    // Pass these values directly to wikipedia_get_section / wikipedia_get_links.
    const sections = [
      { index: 0, toclevel: 1, title: "Introduction", anchor: "Introduction" },
      ...data.remaining.sections.map((s) => ({
        index: s.id,
        toclevel: s.toclevel ?? 1,
        title: s.line ?? "",
        anchor: s.anchor ?? "",
      })),
    ];

    return { title, sections, section_count: sections.length };
  }

  private async getSection(
    title: string,
    section_index: number,
    max_chars?: number,
  ): Promise<unknown> {
    let data: MobileSectionsResponse;
    try {
      data = await this.fetchSections(title);
    } catch (e) {
      if (e instanceof NotFoundError) return { error: e.message };
      throw e;
    }

    const allSections = allSectionsOf(data);
    const section = allSections.find((s) => s.id === section_index);

    if (!section) {
      return {
        error: `Section index ${section_index} not found. Call wikipedia_list_sections first to see valid indices.`,
      };
    }

    const sectionTitle = section_index === 0 ? "Introduction" : (section.line ?? "");
    const cleaned = cleanSectionText(section.text ?? "");
    const total_chars = cleaned.length;
    const cap = Math.min(Math.max(1, max_chars ?? DEFAULT_SECTION_CHARS), MAX_SECTION_CHARS);
    const truncated = cleaned.length > cap;
    const content = truncated ? cleaned.slice(0, cap) : cleaned;

    return { title, section_title: sectionTitle, section_index, content, total_chars, truncated };
  }

  private async getLinks(
    title: string,
    section_index?: number,
    limit?: number,
  ): Promise<unknown> {
    let data: MobileSectionsResponse;
    try {
      data = await this.fetchSections(title);
    } catch (e) {
      if (e instanceof NotFoundError) return { error: e.message };
      throw e;
    }

    const clampedLimit = Math.min(Math.max(1, limit ?? DEFAULT_LINKS_LIMIT), MAX_LINKS_LIMIT);

    if (section_index !== undefined) {
      const allSections = allSectionsOf(data);
      const section = allSections.find((s) => s.id === section_index);
      if (!section) {
        return {
          error: `Section index ${section_index} not found. Call wikipedia_list_sections first to see valid indices.`,
        };
      }
      const sectionTitle = section_index === 0 ? "Introduction" : (section.line ?? "");
      const links = extractLinks(section.text ?? "");
      return {
        article_title: title,
        section_title: sectionTitle,
        links: links.slice(0, clampedLimit),
        total_links: links.length,
      };
    }

    // Full article: concatenate all section HTML then extract (deduplicates across sections)
    const allSections = allSectionsOf(data);
    const combinedHtml = allSections.map((s) => s.text ?? "").join("\n");
    const links = extractLinks(combinedHtml);
    return {
      article_title: title,
      section_title: null,
      links: links.slice(0, clampedLimit),
      total_links: links.length,
    };
  }
}

class NotFoundError extends Error {}

function allSectionsOf(data: MobileSectionsResponse): MobileSectionEntry[] {
  const lead = data.lead.sections[0];
  return lead ? [lead, ...data.remaining.sections] : data.remaining.sections;
}
