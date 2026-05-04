import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import type { AgentPlugin } from "../../../core/Plugin.ts";
import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";
import type { EditorContextPlugin } from "./EditorContextPlugin.ts";
import { logger } from "../../../logger.ts";

const BIBTEX_SYSTEM = `You are a citation formatter. Given metadata about a web page or document, produce a BibTeX entry.

Use the key format: firstauthor_lastname:year:firstword (e.g., smith:2023:attention)
If author is unknown, use "unknown" for the lastname portion.
If year is unknown, use the current year.
The firstword should be the first meaningful word of the title (lowercase, no punctuation).

Format:
@misc{key,
  title = {Full Title},
  author = {Last, First and Last2, First2},
  year = {YYYY},
  url = {https://...},
  note = {Accessed: YYYY-MM-DD}
}

Return ONLY the BibTeX entry. No preamble or explanation.`;

export interface CitationCheckResult {
  valid: string[];
  broken: string[];
}

export class CitationPlugin implements AgentPlugin {
  name = "Citation";

  private readonly root: string;
  private readonly config: EpistemeConfig;
  private readonly editorContext: EditorContextPlugin;
  private formatterAgent: HeadlessAgent | null = null;

  constructor(
    workspaceRoot: string,
    config: EpistemeConfig,
    editorContext: EditorContextPlugin,
  ) {
    this.root = resolve(workspaceRoot);
    this.config = config;
    this.editorContext = editorContext;
  }

  private getFormatterAgent(): HeadlessAgent {
    if (!this.formatterAgent) {
      const llm = createProvider(featureModel(this.config, "research"));
      this.formatterAgent = new HeadlessAgent(llm, [], BIBTEX_SYSTEM, {
        agentName: "CitationFormatter",
      });
    }
    return this.formatterAgent;
  }

  getSystemPromptFragment(): string {
    return "You can check, format, and export citations for the current document via citation tools.";
  }

  getTools() {
    return [
      {
        name: "check_citations",
        description:
          "Validate the URLs listed in the current document's frontmatter `bibliography` field. Returns valid and broken URLs.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      {
        name: "format_citation",
        description: "Fetch a URL and generate a BibTeX entry for it.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to format as a citation" },
          },
          required: ["url"],
        },
      },
      {
        name: "export_citations",
        description:
          "Format all bibliography URLs from the current document as BibTeX and append them to `references.bib` in the workspace root.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "check_citations") return this.checkCitations();
    if (name === "format_citation") return this.formatCitation(String(args.url ?? ""));
    if (name === "export_citations") return this.exportCitations();
  }

  // ── check_citations ────────────────────────────────────────────────────────

  async checkCitations(): Promise<CitationCheckResult> {
    const content = this.editorContext.activeContent ?? "";
    const urls = this.parseBibliographyUrls(content);
    if (urls.length === 0) return { valid: [], broken: [] };

    const results = await Promise.allSettled(
      urls.map((url) => this.validateUrl(url)),
    );

    const valid: string[] = [];
    const broken: string[] = [];

    for (let i = 0; i < urls.length; i++) {
      const result = results[i];
      const url = urls[i]!;
      if (result?.status === "fulfilled" && result.value) {
        valid.push(url);
      } else {
        broken.push(url);
      }
    }

    logger.info(this.name, `check_citations: ${valid.length} valid, ${broken.length} broken`);
    return { valid, broken };
  }

  // ── format_citation ────────────────────────────────────────────────────────

  async formatCitation(url: string): Promise<string> {
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return `% Error: invalid URL: ${url}`;
    }

    let metadata: { title: string; author: string; date: string; url: string };
    try {
      metadata = await this.extractPageMetadata(url);
    } catch (err) {
      return `% Error fetching ${url}: ${err}`;
    }

    const prompt =
      `Title: ${metadata.title}\n` +
      `Author: ${metadata.author}\n` +
      `Published: ${metadata.date}\n` +
      `URL: ${metadata.url}\n` +
      `Today: ${new Date().toISOString().slice(0, 10)}`;

    return this.getFormatterAgent().ask(prompt);
  }

  // ── export_citations ───────────────────────────────────────────────────────

  async exportCitations(): Promise<{ success: boolean; file: string; count: number }> {
    const content = this.editorContext.activeContent ?? "";
    const urls = this.parseBibliographyUrls(content);
    if (urls.length === 0) {
      return { success: false, file: "references.bib", count: 0 };
    }

    const entries: string[] = [];
    for (const url of urls) {
      try {
        const bibtex = await this.formatCitation(url);
        if (bibtex && !bibtex.startsWith("% Error")) {
          entries.push(bibtex);
        }
      } catch {
        // skip failed entries
      }
    }

    const bibPath = join(this.root, "references.bib");
    let existing = "";
    try {
      existing = await Bun.file(bibPath).text();
    } catch {
      existing = "";
    }

    const separator = existing.trim() ? "\n\n" : "";
    await Bun.write(bibPath, existing + separator + entries.join("\n\n"));

    logger.info(this.name, `Exported ${entries.length} citations to references.bib`);
    return { success: true, file: "references.bib", count: entries.length };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private parseBibliographyUrls(content: string): string[] {
    // Extract YAML frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return [];
    const fm = fmMatch[1] ?? "";

    // Parse bibliography field — supports both list and inline array formats
    const urls: string[] = [];

    // Block sequence: `  - https://...`
    const blockItems = fm.match(/bibliography:\s*\n((?:[ \t]*-[ \t]*.+\n?)+)/);
    if (blockItems) {
      const lines = blockItems[1]!.split("\n");
      for (const line of lines) {
        const m = line.match(/^\s*-\s*(https?:\/\/\S+)/);
        if (m) urls.push(m[1]!.trim());
      }
      return urls;
    }

    // Flow sequence: `bibliography: [url1, url2]`
    const flowItems = fm.match(/bibliography:\s*\[([^\]]+)\]/);
    if (flowItems) {
      const parts = flowItems[1]!.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
      for (const p of parts) {
        if (p.startsWith("http")) urls.push(p);
      }
    }

    return urls;
  }

  private async validateUrl(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { method: "HEAD", signal: controller.signal });
      clearTimeout(timeoutId);
      return res.status < 400;
    } catch {
      return false;
    }
  }

  private async extractPageMetadata(
    url: string,
  ): Promise<{ title: string; author: string; date: string; url: string }> {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    // Use Readability for title and byline
    const article = new Readability(doc).parse();
    const title =
      article?.title ||
      doc.querySelector("meta[property='og:title']")?.getAttribute("content") ||
      doc.querySelector("title")?.textContent ||
      url;

    const author =
      article?.byline ||
      doc.querySelector("meta[name='author']")?.getAttribute("content") ||
      doc.querySelector("meta[property='article:author']")?.getAttribute("content") ||
      "";

    const date =
      doc.querySelector("meta[property='article:published_time']")?.getAttribute("content") ||
      doc.querySelector("meta[name='date']")?.getAttribute("content") ||
      doc.querySelector("time[datetime]")?.getAttribute("datetime") ||
      new Date().getFullYear().toString();

    return {
      title: title.trim(),
      author: author.trim(),
      date: date.trim().slice(0, 10),
      url,
    };
  }
}
