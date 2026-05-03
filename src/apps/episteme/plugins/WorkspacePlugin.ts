import { join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { AgentPlugin, ToolDefinition } from "../../../core/Plugin.ts";
import type { CortexMemoryPlugin } from "../../../plugins/CortexMemoryPlugin.ts";
import { logger } from "../../../logger.ts";
import type { WorkspaceDb, FileLinkRow } from "../db/workspaceDb.ts";
import { findWikilinks, resolveWikilinkTarget } from "../features/wikilinks.ts";

/**
 * Provides workspace-level file access and indexing to the agent.
 *
 * Structural truth lives in `WorkspaceDb` (ws_files + ws_file_links). Memory
 * entries are dual-written for FTS / embeddings coverage but the DB row is the
 * authoritative record for the knowledge graph and incremental reindex.
 */
export class WorkspacePlugin implements AgentPlugin {
  name = "Workspace";
  private readonly root: string;
  private readonly memory: CortexMemoryPlugin | null;
  private readonly workspaceDb: WorkspaceDb;

  constructor(
    workspaceRoot: string,
    memory: CortexMemoryPlugin | null,
    workspaceDb: WorkspaceDb,
  ) {
    this.root = resolve(workspaceRoot);
    this.memory = memory;
    this.workspaceDb = workspaceDb;
  }

  getSystemPromptFragment(): string {
    const fileCount = this.workspaceDb.listWorkspaceFiles().length;
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

  /**
   * Public entry point — called directly on startup and by the agent via executeTool.
   * Incremental: skips files whose (mtime, size) match the stored row.
   */
  async index(): Promise<unknown> {
    const glob = new Bun.Glob("**/*.md");
    const files: string[] = [];

    for await (const match of glob.scan({ cwd: this.root, dot: false })) {
      if (!match.startsWith(".episteme")) files.push(match);
    }

    let indexed = 0;
    let skipped = 0;
    const seen = new Set<string>();

    for (const relPath of files) {
      seen.add(relPath);
      try {
        const absPath = join(this.root, relPath);
        const fileStat = await stat(absPath);
        const mtime = fileStat.mtimeMs;
        const size = fileStat.size;

        const existing = this.workspaceDb.getWorkspaceFile(relPath);
        if (existing && existing.mtime === mtime && existing.size === size) {
          skipped++;
          continue;
        }

        const content = await Bun.file(absPath).text();
        const hasher = new Bun.CryptoHasher("sha256");
        hasher.update(content);
        const contentHash = hasher.digest("hex");
        const lines = content.split("\n");
        const firstLine = lines.find((l) => l.trim().length > 0)?.trim().slice(0, 120) ?? null;
        const wordCount = content.split(/\s+/).filter(Boolean).length;

        this.workspaceDb.upsertWorkspaceFile({
          relPath,
          content,
          mtime,
          size,
          contentHash,
          firstLine,
          wordCount,
        });

        const links = extractLinksForFile(content, files);
        this.workspaceDb.replaceFileLinks(relPath, links);

        // Dual-write into memory for FTS / embeddings coverage. Memory has no
        // upsert/delete API, so re-indexes accumulate duplicate memory entries —
        // the structural row in ws_files remains the source of truth.
        if (this.memory) {
          await this.memory.writeMemory(
            `[File: ${relPath}]\n${content}`,
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

    // Prune rows whose files no longer exist on disk.
    let deleted = 0;
    for (const row of this.workspaceDb.listWorkspaceFiles()) {
      if (!seen.has(row.relPath)) {
        this.workspaceDb.deleteWorkspaceFile(row.relPath);
        deleted++;
      }
    }

    return {
      indexed,
      skipped,
      deleted,
      total: files.length,
      message: `Indexed ${indexed} (skipped ${skipped} unchanged, deleted ${deleted}).`,
    };
  }

  private searchWorkspace(query: string, limit: number): unknown {
    if (!query.trim()) return { results: [], message: "Empty query." };

    const results: Array<{ path: string; excerpt: string; source: string }> = [];

    // 1. Structural LIKE search across ws_files.
    const dbHits = this.workspaceDb.searchWorkspaceFiles(query, limit + 2);
    for (const row of dbHits) {
      const excerpt = row.content.slice(0, 300).replace(/\n+/g, " ").trim();
      results.push({ path: row.relPath, excerpt, source: "index" });
    }

    // 2. Memory FTS fallback for prose-level matches that miss LIKE.
    if (results.length < limit && this.memory) {
      const hits = this.memory.queryMemoriesRaw({
        types: ["factual"],
        contains: query,
        limit: limit + 2,
      });
      for (const hit of hits) {
        if (!hit.tags?.includes("workspace-file")) continue;
        const path = hit.tags.find((t) => t !== "workspace-file") ?? "";
        if (results.find((r) => r.path === path)) continue;
        const excerpt = hit.text.slice(0, 300).replace(/\n+/g, " ").trim();
        results.push({ path, excerpt, source: "memory" });
        if (results.length >= limit) break;
      }
    }

    if (results.length === 0 && this.workspaceDb.listWorkspaceFiles().length === 0) {
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
    const rows = this.workspaceDb.listWorkspaceFiles();
    if (rows.length === 0) {
      return { files: [], message: "Workspace not indexed. Run index_workspace first." };
    }
    const files = rows.map((r) => ({
      path: r.relPath,
      firstLine: r.firstLine ?? r.relPath,
      words: r.wordCount ?? 0,
    }));
    return { files, total: files.length };
  }
}

/**
 * Extract resolved wikilinks and relative markdown links from `content`.
 * Both link types are resolved against the full workspace file list, so
 * `[[notes/foo]]` and `[foo](./notes/foo.md)` both produce a link with
 * `targetPath = "notes/foo.md"` when that file exists.
 */
function extractLinksForFile(
  content: string,
  allFiles: string[],
): Omit<FileLinkRow, "sourcePath">[] {
  const links: Omit<FileLinkRow, "sourcePath">[] = [];

  for (const wl of findWikilinks(content)) {
    const target = resolveWikilinkTarget(wl.target, allFiles);
    if (target) {
      links.push({ targetPath: target, linkType: "wikilink", raw: wl.target });
    }
  }

  for (const m of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = (m[1] ?? "").trim();
    if (!href) continue;
    if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) continue;
    const cleaned = href.replace(/^\.\//, "").replace(/[?#].*$/, "");
    if (!cleaned) continue;
    const target = resolveWikilinkTarget(cleaned, allFiles);
    if (target) {
      links.push({ targetPath: target, linkType: "markdown", raw: href });
    }
  }

  return links;
}
