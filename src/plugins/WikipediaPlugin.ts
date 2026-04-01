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

// One entry from the article's table of contents.
// `index` is the value to pass as `section=` in the action API and to
// wikipedia_get_section / wikipedia_get_links.
interface TocEntry {
  index: number;
  toclevel: number;
  line: string;
  anchor: string;
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

// Extracts internal Wikipedia links from rendered article HTML using the
// title attribute on anchor elements. The inner-text capture ([^<]+) only
// matches plain text directly inside the <a> tag — links whose visible text
// is wrapped in a child element (e.g. <a title="Foo"><b>Bold</b></a>) will
// be silently skipped. This is an acceptable trade-off for Wikipedia HTML.
//
// Links whose title contains ":" are excluded — this filters out namespace-
// prefixed links (File:, Category:, Wikipedia:, Special:, edit links whose
// title reads "Edit section: …", etc.). The known trade-off is that
// legitimate article titles containing colons (e.g. subtitled works) will
// also be excluded.
function extractLinks(html: string): WikiLink[] {
  const pattern = /<a[^>]+title="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  const seen = new Set<string>();
  const links: WikiLink[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const title = match[1]!;
    const text = match[2]!.trim();
    if (title.includes(":")) continue;
    if (!seen.has(title)) {
      seen.add(title);
      links.push({ text, title });
    }
  }
  return links;
}

export class WikipediaPlugin implements AgentPlugin {
  name = "WikipediaPlugin";

  // Cache for table-of-contents data, keyed by normalised article title.
  private readonly tocCache = new Map<string, { data: TocEntry[]; expiresAt: number }>();
  // Cache for individual section HTML, keyed by "normalised_title:sectionIndex".
  private readonly sectionHtmlCache = new Map<string, { html: string; expiresAt: number }>();

  getSystemPromptFragment(): string {
    return [
      "You have access to Wikipedia via these tools:",
      "- `wikipedia_search`: find an article by topic. Use this only to locate a new article, not to look up content you already have.",
      "- `wikipedia_get_article`: short summary of an article (first paragraph only).",
      "- `wikipedia_list_sections`: get the table of contents for an article. Call this ONCE per article — you do not need to call it again before each section fetch.",
      "- `wikipedia_get_section`: read one section by its index from the table of contents. Fetch sections sequentially; do not re-list sections between fetches.",
      "- `wikipedia_get_links`: extract links from an article. Only use this when the user explicitly asks to explore or follow linked articles.",
      "Once you have listed sections and fetched the ones you need, respond to the user — do not keep searching or re-listing.",
    ].join("\n");
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
          "Get the table of contents for a Wikipedia article — section titles, indices, and depth levels. Call this once per article to plan which sections to fetch. Do not call it again for the same article.",
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
          "Extract internal Wikipedia links from an article or a specific section. Returns link text and article titles usable directly with wikipedia_get_article. Only use this when the user explicitly asks to explore or follow linked articles.",
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
    logger.debug("WikipediaPlugin", `tool called: ${name}`, args);
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
    logger.debug("WikipediaPlugin", `search returned ${results.length} results`);

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
      logger.debug("WikipediaPlugin", `article not found: "${title}"`);
      return { error: `Article not found: "${title}". Try searching first.` };
    }
    if (!res.ok) {
      throw new Error(`Wikipedia fetch failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    logger.debug(
      "WikipediaPlugin",
      `article summary returned: "${data.title}" (${data.extract?.length ?? 0} chars)`,
    );
    return {
      title: data.title,
      description: data.description,
      extract: data.extract,
      url: data.content_urls?.desktop?.page,
    };
  }

  // Fetches the table of contents via action=parse&prop=sections.
  // Results are cached per normalised title for CACHE_TTL_MS.
  private async fetchToc(title: string): Promise<TocEntry[]> {
    const cacheKey = title.replace(/ /g, "_");
    const cached = this.tocCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug("WikipediaPlugin", `TOC cache hit: "${title}"`);
      return cached.data;
    }

    logger.debug("WikipediaPlugin", `fetching TOC: "${title}"`);
    const params = new URLSearchParams({
      action: "parse",
      page: title,
      prop: "sections",
      format: "json",
    });
    const res = await fetch(`${API_BASE}?${params}`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      logger.debug("WikipediaPlugin", `TOC fetch failed: "${title}" status=${res.status}`);
      throw new Error(`Wikipedia API failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (data.error) {
      logger.debug("WikipediaPlugin", `TOC not found: "${title}" — ${data.error.info}`);
      throw new NotFoundError(`Article not found: "${title}". Try searching first.`);
    }

    const entries: TocEntry[] = (data.parse?.sections ?? []).map(
      (s: { index: string; toclevel: number; line: string; anchor: string }) => ({
        index: Number(s.index),
        toclevel: s.toclevel ?? 1,
        line: s.line ?? "",
        anchor: s.anchor ?? "",
      }),
    );

    logger.debug("WikipediaPlugin", `TOC fetched: "${title}" (${entries.length} sections)`);
    this.tocCache.set(cacheKey, { data: entries, expiresAt: Date.now() + CACHE_TTL_MS });
    return entries;
  }

  // Fetches the rendered HTML for one section via action=parse&prop=text&section=N.
  // section=0 is the lead/introduction; higher indices match those from fetchToc.
  // Results are cached per "normalised_title:sectionIndex" for CACHE_TTL_MS.
  private async fetchSectionHtml(title: string, sectionIndex: number): Promise<string> {
    const cacheKey = `${title.replace(/ /g, "_")}:${sectionIndex}`;
    const cached = this.sectionHtmlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug("WikipediaPlugin", `section HTML cache hit: "${title}" §${sectionIndex}`);
      return cached.html;
    }

    logger.debug("WikipediaPlugin", `fetching section HTML: "${title}" §${sectionIndex}`);
    const params = new URLSearchParams({
      action: "parse",
      page: title,
      prop: "text",
      section: String(sectionIndex),
      format: "json",
    });
    const res = await fetch(`${API_BASE}?${params}`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      logger.debug(
        "WikipediaPlugin",
        `section HTML fetch failed: "${title}" §${sectionIndex} status=${res.status}`,
      );
      throw new Error(`Wikipedia API failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    if (data.error) {
      logger.debug(
        "WikipediaPlugin",
        `section HTML not found: "${title}" §${sectionIndex} — ${data.error.info}`,
      );
      throw new NotFoundError(`Article not found: "${title}". Try searching first.`);
    }

    const html: string = data.parse?.text?.["*"] ?? "";
    logger.debug(
      "WikipediaPlugin",
      `section HTML fetched: "${title}" §${sectionIndex} (${html.length} bytes)`,
    );
    this.sectionHtmlCache.set(cacheKey, { html, expiresAt: Date.now() + CACHE_TTL_MS });
    return html;
  }

  private async listSections(title: string): Promise<unknown> {
    let entries: TocEntry[];
    try {
      entries = await this.fetchToc(title);
    } catch (e) {
      if (e instanceof NotFoundError) return { error: (e as Error).message };
      throw e;
    }

    // `index` mirrors the API's section index (not positional array index).
    // Pass these values directly to wikipedia_get_section / wikipedia_get_links.
    const sections = [
      { index: 0, toclevel: 1, title: "Introduction", anchor: "Introduction" },
      ...entries.map((s) => ({
        index: s.index,
        toclevel: s.toclevel,
        title: s.line,
        anchor: s.anchor,
      })),
    ];

    logger.debug(
      "WikipediaPlugin",
      `list_sections returning ${sections.length} sections for "${title}"`,
    );
    return { title, sections, section_count: sections.length };
  }

  private async getSection(
    title: string,
    section_index: number,
    max_chars?: number,
  ): Promise<unknown> {
    let html: string;
    let sectionTitle = "Introduction";

    try {
      if (section_index !== 0) {
        const entries = await this.fetchToc(title);
        const entry = entries.find((s) => s.index === section_index);
        if (!entry) {
          logger.debug(
            "WikipediaPlugin",
            `get_section: index ${section_index} not found in "${title}"`,
          );
          return {
            error: `Section index ${section_index} not found. Call wikipedia_list_sections first to see valid indices.`,
          };
        }
        sectionTitle = entry.line;
      }
      html = await this.fetchSectionHtml(title, section_index);
    } catch (e) {
      if (e instanceof NotFoundError) return { error: (e as Error).message };
      throw e;
    }

    const cleaned = cleanSectionText(html);
    const total_chars = cleaned.length;
    const cap = Math.min(Math.max(1, max_chars ?? DEFAULT_SECTION_CHARS), MAX_SECTION_CHARS);
    const truncated = cleaned.length > cap;
    const content = truncated ? cleaned.slice(0, cap) : cleaned;

    logger.debug(
      "WikipediaPlugin",
      `get_section: "${title}" §${section_index} "${sectionTitle}" — ${total_chars} chars${truncated ? ` (truncated to ${cap})` : ""}`,
    );
    return { title, section_title: sectionTitle, section_index, content, total_chars, truncated };
  }

  private async getLinks(
    title: string,
    section_index?: number,
    limit?: number,
  ): Promise<unknown> {
    const clampedLimit = Math.min(Math.max(1, limit ?? DEFAULT_LINKS_LIMIT), MAX_LINKS_LIMIT);

    try {
      if (section_index !== undefined) {
        let sectionTitle = "Introduction";
        if (section_index !== 0) {
          const entries = await this.fetchToc(title);
          const entry = entries.find((s) => s.index === section_index);
          if (!entry) {
            logger.debug(
              "WikipediaPlugin",
              `get_links: index ${section_index} not found in "${title}"`,
            );
            return {
              error: `Section index ${section_index} not found. Call wikipedia_list_sections first to see valid indices.`,
            };
          }
          sectionTitle = entry.line;
        }
        const html = await this.fetchSectionHtml(title, section_index);
        const links = extractLinks(html);
        logger.debug(
          "WikipediaPlugin",
          `get_links: "${title}" §${section_index} "${sectionTitle}" — ${links.length} links (returning ${Math.min(links.length, clampedLimit)})`,
        );
        return {
          article_title: title,
          section_title: sectionTitle,
          links: links.slice(0, clampedLimit),
          total_links: links.length,
        };
      }

      // Full article: use action=query&prop=links — returns all wikilinks without
      // fetching the full HTML of every section. text=title since this API
      // doesn't return display text.
      logger.debug("WikipediaPlugin", `fetching full article links: "${title}"`);
      const params = new URLSearchParams({
        action: "query",
        titles: title,
        prop: "links",
        pllimit: "500",
        plnamespace: "0",
        format: "json",
      });
      const res = await fetch(`${API_BASE}?${params}`, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) throw new Error(`Wikipedia API failed: ${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.error) throw new NotFoundError(`Article not found: "${title}". Try searching first.`);

      const pages: Record<string, { missing?: string; links?: { title: string }[] }> =
        data.query?.pages ?? {};
      const page = Object.values(pages)[0];
      if (!page || "missing" in page) {
        throw new NotFoundError(`Article not found: "${title}". Try searching first.`);
      }

      const links: WikiLink[] = (page.links ?? []).map((l) => ({
        text: l.title,
        title: l.title,
      }));

      logger.debug(
        "WikipediaPlugin",
        `get_links: "${title}" full article — ${links.length} links (returning ${Math.min(links.length, clampedLimit)})`,
      );
      return {
        article_title: title,
        section_title: null,
        links: links.slice(0, clampedLimit),
        total_links: links.length,
      };
    } catch (e) {
      if (e instanceof NotFoundError) return { error: (e as Error).message };
      throw e;
    }
  }
}

class NotFoundError extends Error {}
