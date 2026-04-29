import { join, resolve, basename } from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import type { AgentPlugin } from "../../../core/Plugin.ts";
import type { CortexMemoryPlugin } from "../../../plugins/CortexMemoryPlugin.ts";
import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";
import { logger } from "../../../logger.ts";

// Point at the bundled worker so pdfjs can offload CPU work
GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).href;

const SUMMARIZE_SYSTEM = `You are a research assistant. Summarize the given content into structured Markdown. Use the following template:

## Summary
<2-4 sentence overview>

## Key Points
- ...

## Source
<URL or filename>

Return ONLY the Markdown. No preamble.`;

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
    return "You can ingest URLs and PDFs from the workspace via research tools. Ingested content is summarized and saved to memory and as Markdown files.";
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
        description: "Extract text from a PDF file already in the workspace, summarize it, and save to memory.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path to the PDF within the workspace" },
          },
          required: ["path"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "ingest_url") return this.ingestUrl(String(args.url ?? ""));
    if (name === "ingest_pdf") return this.ingestPdf(String(args.path ?? ""));
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

    // Extract readable content with JSDOM + Readability
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article) return { error: "Could not extract readable content from page." };

    const rawText = article.textContent?.slice(0, 8000) ?? "";
    const summary = await this.summarize(rawText, url);

    // Save to memory and workspace
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
    if (!absPath.startsWith(this.root)) {
      return { error: "Path escapes workspace boundary." };
    }

    let rawText: string;
    try {
      const fileData = await Bun.file(absPath).arrayBuffer();
      rawText = await this.extractPdfText(fileData);
    } catch (err) {
      return { error: `Failed to read PDF: ${err}` };
    }

    if (!rawText.trim()) return { error: "No text could be extracted from the PDF." };

    const summary = await this.summarize(rawText.slice(0, 8000), basename(relativePath));

    const stem = basename(relativePath).replace(/\.pdf$/i, "");
    const mdPath = join(this.root, "research", `${stem}.md`);
    await this.saveMarkdown(mdPath, summary);

    if (this.memory) {
      await this.memory.writeMemory(summary, "factual", ["ingested", "pdf", relativePath], "research");
    }

    logger.info(this.name, `Ingested PDF: ${relativePath} → research/${stem}.md`);
    return { success: true, file: `research/${stem}.md`, summary };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private async summarize(text: string, source: string): Promise<string> {
    const llm = createProvider(featureModel(this.config, "research"));
    const agent = new HeadlessAgent(llm, [], SUMMARIZE_SYSTEM, {
      agentName: "ResearchSummarizer",
    });
    return agent.ask(`Summarize the following content (source: ${source}):\n\n${text}`);
  }

  private async extractPdfText(data: ArrayBuffer): Promise<string> {
    const pdf = await getDocument({ data }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .filter((item) => "str" in item)
        .map((item) => (item as { str: string }).str)
        .join(" ");
      pages.push(pageText);
    }
    return pages.join("\n\n");
  }

  private async saveMarkdown(absPath: string, content: string): Promise<void> {
    // Ensure research/ directory exists
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
