import { join, resolve, basename } from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { AgentPlugin } from "../../../core/Plugin.ts";
import type { CortexMemoryPlugin } from "../../../plugins/CortexMemoryPlugin.ts";
import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";
import { logger } from "../../../logger.ts";
import { deepIngestPdf } from "../features/research.ts";

const SUMMARIZE_SYSTEM = `You are a research assistant. Summarize the given content into structured Markdown. Use the following template:

## Summary
<2-4 sentence overview>

## Key Points
- ...

## Source
<URL or filename>

Return ONLY the Markdown. No preamble.`;

const GAP_DETECTION_SYSTEM = `You are a research assistant analyzing a knowledge base for gaps.
Given a topic and a set of workspace notes, identify:
1. Perspectives or viewpoints not covered
2. Counterarguments or dissenting views missing
3. Sub-topics that deserve deeper coverage
4. Important recent developments not mentioned
5. Methodological or empirical gaps

Format your response as Markdown with clear sections. Be specific and actionable.
Return ONLY the Markdown. No preamble.`;

export interface SearchResult {
  title: string;
  excerpt: string;
  authors: string[];
  date: string;
  url: string;
  source: "arxiv" | "wikipedia" | "workspace";
}

export interface UnifiedSearchResponse {
  arxiv: SearchResult[];
  wikipedia: SearchResult[];
  workspace: SearchResult[];
  all: SearchResult[];
}

export class ResearchPlugin implements AgentPlugin {
  name = "Research";

  private readonly root: string;
  private readonly memory: CortexMemoryPlugin | null;
  private readonly config: EpistemeConfig;

  constructor(workspaceRoot: string, config: EpistemeConfig, memory: CortexMemoryPlugin | null = null) {
    this.root = resolve(workspaceRoot);
    this.memory = memory;
    this.config = config;
  }

  getSystemPromptFragment(): string {
    return "You can ingest URLs and PDFs, search arXiv and Wikipedia, run unified search across all sources, and detect knowledge gaps in the workspace via research tools.";
  }

  getTools() {
    return [
      {
        name: "ingest_url",
        description: "Fetch a URL, extract its readable content, summarize it, and save to workspace and memory.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to ingest" },
          },
          required: ["url"],
        },
      },
      {
        name: "ingest_pdf",
        description: "Extract text from a PDF file in the workspace using deep structured ingestion, and save to .episteme/ingested/ and memory.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path to the PDF within the workspace" },
          },
          required: ["path"],
        },
      },
      {
        name: "search_arxiv",
        description: "Search arXiv for academic papers matching a query. Returns titles, authors, abstracts, and links.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "search_wikipedia",
        description: "Search Wikipedia for articles matching a query. Returns titles, excerpts, and URLs.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "unified_search",
        description: "Search arXiv, Wikipedia, and the workspace simultaneously. Returns merged and ranked results.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "detect_gaps",
        description: "Analyze workspace notes on a topic and identify missing perspectives, counterarguments, or sub-topics.",
        parameters: {
          type: "object",
          properties: {
            topic: { type: "string", description: "The topic to analyze for knowledge gaps" },
          },
          required: ["topic"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "ingest_url") return this.ingestUrl(String(args.url ?? ""));
    if (name === "ingest_pdf") return this.ingestPdf(String(args.path ?? ""));
    if (name === "search_arxiv") return this.searchArxiv(String(args.query ?? ""));
    if (name === "search_wikipedia") return this.searchWikipedia(String(args.query ?? ""));
    if (name === "unified_search") return this.unifiedSearch(String(args.query ?? ""));
    if (name === "detect_gaps") return this.detectGaps(String(args.topic ?? ""));
  }

  // ── ingest_url ─────────────────────────────────────────────────────────────

  async ingestUrl(url: string): Promise<unknown> {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return { error: "Only http/https URLs are supported." };
    }

    let html: string;
    try {
      const res = await fetch(url);
      if (!res.ok) return { error: `HTTP ${res.status} fetching ${url}` };
      html = await res.text();
    } catch (err) {
      return { error: `Failed to fetch URL: ${err}` };
    }

    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article) return { error: "Could not extract readable content from page." };

    const rawText = article.textContent?.slice(0, 8000) ?? "";
    const summary = await this.summarize(rawText, url);

    const slug = this.urlToSlug(url);
    const mdPath = join(this.root, "research", `${slug}.md`);
    await this.saveMarkdown(mdPath, summary);

    if (this.memory) {
      await this.memory.writeMemory(summary, "factual", ["ingested", "url", url], "research");
    }

    logger.info(this.name, `Ingested URL: ${url} → research/${slug}.md`);
    return { success: true, file: `research/${slug}.md`, summary };
  }

  // ── ingest_pdf ─────────────────────────────────────────────────────────────

  async ingestPdf(relativePath: string): Promise<unknown> {
    const absPath = resolve(join(this.root, relativePath));
    if (absPath !== this.root && !absPath.startsWith(this.root + "/")) {
      return { error: "Path escapes workspace boundary." };
    }

    let pdfData: ArrayBuffer;
    try {
      pdfData = await Bun.file(absPath).arrayBuffer();
    } catch (err) {
      return { error: `Failed to read PDF: ${err}` };
    }

    let structured: string;
    try {
      structured = await deepIngestPdf(pdfData, basename(relativePath), this.config);
    } catch (err) {
      return { error: `Deep ingestion failed: ${err}` };
    }

    if (!structured.trim()) return { error: "No content could be extracted from the PDF." };

    const stem = basename(relativePath).replace(/\.pdf$/i, "");
    const ingestedDir = join(this.root, ".episteme", "ingested");
    const mdPath = join(ingestedDir, `${stem}.md`);
    await this.saveMarkdown(mdPath, structured);

    if (this.memory) {
      await this.memory.writeMemory(structured, "factual", ["ingested", "pdf", relativePath], "research");
    }

    logger.info(this.name, `Deep-ingested PDF: ${relativePath} → .episteme/ingested/${stem}.md`);
    return { success: true, file: `.episteme/ingested/${stem}.md`, summary: structured };
  }

  // ── search_arxiv ───────────────────────────────────────────────────────────

  async searchArxiv(query: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];
    const encoded = encodeURIComponent(query);
    const url = `https://export.arxiv.org/api/query?search_query=all:${encoded}&max_results=10`;

    let xml: string;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      xml = await res.text();
    } catch {
      return [];
    }

    const dom = new JSDOM(xml, { contentType: "application/xml" });
    const doc = dom.window.document;
    const entries = doc.querySelectorAll("entry");
    const results: SearchResult[] = [];

    for (const entry of entries) {
      const title = entry.querySelector("title")?.textContent?.trim().replace(/\s+/g, " ") ?? "";
      const summary = entry.querySelector("summary")?.textContent?.trim().replace(/\s+/g, " ").slice(0, 400) ?? "";
      const authors = Array.from(entry.querySelectorAll("author name"))
        .map((n) => n.textContent?.trim() ?? "")
        .filter(Boolean)
        .slice(0, 4);
      const published = entry.querySelector("published")?.textContent?.slice(0, 10) ?? "";
      // Prefer the HTML abs link
      let link =
        entry.querySelector("link[type='text/html']")?.getAttribute("href") ??
        entry.querySelector("link")?.getAttribute("href") ??
        "";
      // arxiv id link: convert to abs URL if needed
      if (link && !link.startsWith("http")) {
        link = `https://arxiv.org/abs/${link}`;
      }

      if (title && link) {
        results.push({ title, excerpt: summary, authors, date: published, url: link, source: "arxiv" });
      }
    }

    return results;
  }

  // ── search_wikipedia ───────────────────────────────────────────────────────

  async searchWikipedia(query: string): Promise<SearchResult[]> {
    if (!query.trim()) return [];
    const encoded = encodeURIComponent(query);
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&origin=*&srlimit=10`;

    let data: { query?: { search?: Array<{ title: string; snippet: string; pageid: number }> } };
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      data = (await res.json()) as typeof data;
    } catch {
      return [];
    }

    const items = data?.query?.search ?? [];
    return items.map((item) => ({
      title: item.title ?? "",
      excerpt: (item.snippet ?? "").replace(/<[^>]+>/g, "").slice(0, 400),
      authors: [],
      date: "",
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent((item.title ?? "").replace(/ /g, "_"))}`,
      source: "wikipedia" as const,
    }));
  }

  // ── search_workspace (internal) ────────────────────────────────────────────

  private searchWorkspaceMemory(query: string): SearchResult[] {
    if (!this.memory) return [];

    const memories = this.memory.queryMemoriesRaw({
      tags: ["workspace-file"],
      contains: query,
      limit: 8,
    });

    return memories.map((m) => {
      const path = m.tags.find((t) => t !== "workspace-file") ?? "";
      const title = path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path;
      return {
        title,
        excerpt: m.text.replace(/\n+/g, " ").slice(0, 400),
        authors: [],
        date: "",
        url: path,
        source: "workspace" as const,
      };
    });
  }

  // ── unified_search ─────────────────────────────────────────────────────────

  async unifiedSearch(query: string): Promise<UnifiedSearchResponse> {
    const [arxiv, wikipedia] = await Promise.all([
      this.searchArxiv(query),
      this.searchWikipedia(query),
    ]);
    const workspace = this.searchWorkspaceMemory(query);

    // Merge: workspace first (highest relevance to user's existing notes), then external
    const seen = new Set<string>();
    const all: SearchResult[] = [];

    for (const r of workspace) {
      if (!seen.has(r.url)) { seen.add(r.url); all.push(r); }
    }
    for (const r of [...arxiv, ...wikipedia]) {
      if (!seen.has(r.url)) { seen.add(r.url); all.push(r); }
    }

    return { arxiv, wikipedia, workspace, all };
  }

  // ── detect_gaps ────────────────────────────────────────────────────────────

  async detectGaps(topic: string): Promise<string> {
    if (!this.memory) {
      return "# Knowledge Gap Report\n\nNo workspace memory available. Run `index_workspace` first.";
    }

    const memories = this.memory.queryMemoriesRaw({
      tags: ["workspace-file"],
      limit: 20,
    });

    if (memories.length === 0) {
      return "# Knowledge Gap Report\n\nNo indexed workspace files found. Run `index_workspace` first.";
    }

    const context = memories
      .map((m) => m.text.slice(0, 600))
      .join("\n\n---\n\n");

    const llm = createProvider(featureModel(this.config, "research"));
    const agent = new HeadlessAgent(llm, [], GAP_DETECTION_SYSTEM, {
      agentName: "GapDetector",
    });

    return agent.ask(`Topic: ${topic}\n\nWorkspace notes:\n\n${context}`);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async summarize(text: string, source: string): Promise<string> {
    const llm = createProvider(featureModel(this.config, "research"));
    const agent = new HeadlessAgent(llm, [], SUMMARIZE_SYSTEM, {
      agentName: "ResearchSummarizer",
    });
    return agent.ask(`Summarize the following content (source: ${source}):\n\n${text}`);
  }

  private async saveMarkdown(absPath: string, content: string): Promise<void> {
    const dir = absPath.slice(0, absPath.lastIndexOf("/"));
    await Bun.$`mkdir -p ${dir}`.quiet();
    await Bun.write(absPath, content);
  }

  private urlToSlug(url: string): string {
    return url
      .replace(/^https?:\/\//, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80);
  }
}
