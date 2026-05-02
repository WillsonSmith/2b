import { join, resolve, relative } from "node:path";
import type { AgentPlugin, ToolDefinition } from "../../../core/Plugin.ts";
import type { CortexMemoryPlugin } from "../../../plugins/CortexMemoryPlugin.ts";
import { logger } from "../../../logger.ts";

interface FileEntry {
  relativePath: string;
  firstLine: string;
  wordCount: number;
}

/**
 * Provides workspace-level file access and indexing to the agent.
 *
 * Phase 1: file crawling with FTS5 keyword search via CortexMemoryPlugin.
 * Phase 5: full semantic search (vector embeddings).
 */
export class WorkspacePlugin implements AgentPlugin {
  name = "Workspace";
  private readonly root: string;
  private readonly memory: CortexMemoryPlugin | null;

  /** In-memory cache built by index_workspace(). Maps relative path → entry. */
  private fileIndex = new Map<string, FileEntry>();
  private lastIndexed: number = 0;

  constructor(workspaceRoot: string, memory: CortexMemoryPlugin | null = null) {
    this.root = resolve(workspaceRoot);
    this.memory = memory;
  }

  getSystemPromptFragment(): string {
    const fileCount = this.fileIndex.size;
    const indexed = fileCount > 0 ? ` (${fileCount} files indexed)` : " (not yet indexed)";
    return `You have access to a Markdown workspace at: ${this.root}${indexed}\nUse workspace tools to index, search, and read files in the workspace.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "index_workspace",
        description:
          "Crawl the workspace and index all Markdown (.md) files into memory for search. Run this after opening a new workspace or when files have changed.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      {
        name: "search_workspace",
        description:
          "Search across all indexed Markdown files in the workspace by keyword or phrase. Returns matching file passages with paths.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Keyword or phrase to search for" },
            limit: { type: "number", description: "Maximum results to return (default 8)" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_workspace_file",
        description: "Read the full content of a file in the workspace by its relative path.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path to the file (e.g. 'notes/intro.md')" },
          },
          required: ["path"],
        },
      },
      {
        name: "list_workspace_files",
        description: "List all Markdown files in the workspace with their first line and approximate word count.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      {
        name: "fact_check",
        description:
          "Search workspace memory for notes that confirm or contradict a given claim. Returns matching passages.",
        parameters: {
          type: "object",
          properties: {
            claim: { type: "string", description: "The claim or statement to fact-check." },
          },
          required: ["claim"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "index_workspace") return this.index();
    if (name === "search_workspace") return this.searchWorkspace(String(args.query ?? ""), Number(args.limit ?? 8));
    if (name === "get_workspace_file") return this.getFile(String(args.path ?? ""));
    if (name === "list_workspace_files") return this.listFiles();
    if (name === "fact_check") return this.factCheck(String(args.claim ?? ""));
  }

  // ── Tool implementations ───────────────────────────────────────────────────

  /** Public entry point — called directly on startup and by the agent via executeTool. */
  async index(): Promise<unknown> {
    const glob = new Bun.Glob("**/*.md");
    const files: string[] = [];

    for await (const match of glob.scan({ cwd: this.root, dot: false })) {
      if (!match.startsWith(".episteme")) files.push(match);
    }

    let indexed = 0;
    for (const relPath of files) {
      try {
        const absPath = join(this.root, relPath);
        const content = await Bun.file(absPath).text();
        const lines = content.split("\n");
        const firstLine = lines.find((l) => l.trim().length > 0)?.trim().slice(0, 120) ?? relPath;
        const wordCount = content.split(/\s+/).filter(Boolean).length;

        const alreadyIndexed = this.fileIndex.has(relPath);
        this.fileIndex.set(relPath, { relativePath: relPath, firstLine, wordCount });

        // Only write to memory on first index — prevents accumulation of duplicate entries
        // across re-index calls (memory has no upsert/delete API).
        if (this.memory && !alreadyIndexed) {
          const summary = content.slice(0, 800).trim();
          await this.memory.writeMemory(
            `[File: ${relPath}]\n${summary}`,
            "factual",
            ["workspace-file", relPath],
            "workspace-index",
          );
        }

        indexed++;
      } catch (err) {
        logger.warn(this.name, `Failed to index ${relPath}:`, err);
      }
    }

    this.lastIndexed = Date.now();
    return {
      indexed,
      total: files.length,
      message: `Indexed ${indexed} Markdown files from workspace.`,
    };
  }

  private async searchWorkspace(query: string, limit: number): Promise<unknown> {
    if (!query.trim()) return { results: [], message: "Empty query." };

    const results: Array<{ path: string; excerpt: string; source: string }> = [];

    // 1. Search via CortexMemoryPlugin FTS5 (workspace-indexed memories)
    if (this.memory) {
      const hits = this.memory.queryMemoriesRaw({
        types: ["factual"],
        contains: query,
        limit: limit + 2, // small over-fetch to allow de-duplication
      });

      for (const hit of hits) {
        if (hit.tags?.includes("workspace-file")) {
          const excerpt = hit.text.slice(0, 300).replace(/\n+/g, " ").trim();
          const pathTag = hit.tags.find((t) => t !== "workspace-file") ?? "";
          results.push({ path: pathTag, excerpt, source: "index" });
        }
      }
    }

    // 2. Fallback: in-memory keyword scan (always runs; deduplicated by path)
    if (results.length < limit) {
      const lower = query.toLowerCase();
      for (const [relPath, entry] of this.fileIndex) {
        if (results.find((r) => r.path === relPath)) continue;
        if (
          relPath.toLowerCase().includes(lower) ||
          entry.firstLine.toLowerCase().includes(lower)
        ) {
          results.push({
            path: relPath,
            excerpt: entry.firstLine,
            source: "filename",
          });
        }
        if (results.length >= limit) break;
      }
    }

    // 3. If still no results and no index built, do a live grep across files
    if (results.length === 0 && this.fileIndex.size === 0) {
      return {
        results: [],
        message:
          "No results. Workspace is not indexed yet — run index_workspace first for full search.",
      };
    }

    return { results: results.slice(0, limit), query };
  }

  private async getFile(relativePath: string): Promise<unknown> {
    if (!relativePath) return { error: "No path provided." };
    const absolute = resolve(join(this.root, relativePath));
    if (absolute !== this.root && !absolute.startsWith(this.root + "/")) return { error: "Path escapes workspace boundary." };
    try {
      const content = await Bun.file(absolute).text();
      return { path: relativePath, content };
    } catch {
      return { error: `File not found: ${relativePath}` };
    }
  }

  private factCheck(claim: string): unknown {
    if (!claim.trim()) return { matches: [], message: "Empty claim." };
    if (!this.memory) {
      return { matches: [], message: "Workspace not indexed. Run index_workspace first." };
    }
    const hits = this.memory.queryMemoriesRaw({
      types: ["factual"],
      contains: claim,
      limit: 6,
    });
    const matches = hits
      .filter((h) => h.tags?.includes("workspace-file"))
      .map((h) => ({
        path: h.tags?.find((t) => t !== "workspace-file") ?? "",
        excerpt: h.text.slice(0, 300).replace(/\n+/g, " ").trim(),
      }));
    return {
      matches,
      claim,
      note: "Full contradiction detection available in Phase 5.",
    };
  }

  private listFiles(): unknown {
    if (this.fileIndex.size === 0) {
      return { files: [], message: "Workspace not indexed. Run index_workspace first." };
    }
    const files = [...this.fileIndex.values()].map((e) => ({
      path: e.relativePath,
      firstLine: e.firstLine,
      words: e.wordCount,
    }));
    return { files, total: files.length };
  }
}
