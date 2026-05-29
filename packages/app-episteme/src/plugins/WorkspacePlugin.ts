import { join, resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { AgentPlugin, ToolDefinition } from "@2b/framework/core/Plugin.ts";
import { logger } from "@2b/framework/logger.ts";
import type { WorkspaceDb, FileLinkRow, WorkspaceSearchHit } from "../db/workspaceDb.ts";
import { resolveLocalHref } from "../features/links.ts";

const DEFAULT_GRAPH_LIMIT = 500;

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  file?: string;
  color: string;
}

export interface GraphLink {
  source: string;
  target: string;
  linkType: string;
  color: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  deleted: number;
  total: number;
  message: string;
}

/**
 * Provides workspace-level file access and indexing to the agent.
 *
 * Structural truth lives in `WorkspaceDb` (ws_files + ws_file_links + ws_files_fts).
 * Workspace search runs against the FTS5 index.
 */
export class WorkspacePlugin implements AgentPlugin {
  name = "Workspace";
  private readonly root: string;
  private readonly workspaceDb: WorkspaceDb;
  private progressListener: ((indexed: number, total: number) => void) | null = null;

  constructor(workspaceRoot: string, workspaceDb: WorkspaceDb) {
    this.root = resolve(workspaceRoot);
    this.workspaceDb = workspaceDb;
  }

  /** Register a callback invoked once before, and once after each batch of, index(). */
  setIndexProgressListener(listener: (indexed: number, total: number) => void): void {
    this.progressListener = listener;
  }

  getSystemPromptFragment(): string {
    const fileCount = this.workspaceDb.listWorkspaceFiles().length;
    const indexed = fileCount > 0 ? ` (${fileCount} files indexed)` : " (not yet indexed)";
    return [
      `You have access to a Markdown workspace at: ${this.root}${indexed}`,
      "Search the workspace before reaching for external sources — the user's own notes are the highest-priority context.",
      "Use workspace tools to index, search, and read files in the workspace. For large Markdown files, use search_workspace to locate relevant content by keyword, then get_workspace_section to read a specific section by heading. Use read_file with offset and limit for precise line ranges.",
      "Workspace files are connected by standard Markdown links — not wikilinks. When inserting a link between files, use `[display text](./relative/path.md)`, where the path is relative to the file being edited (not the workspace root).",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
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
        name: "get_workspace_section",
        description:
          "Read a specific section of a Markdown file by heading text. Use search_workspace to find which file and heading contains relevant content, then call this to read just that section. Preferred over read_file for large documents.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path to the file (e.g. 'notes/intro.md')" },
            heading: { type: "string", description: "Heading text to find (case-insensitive, partial match supported)" },
          },
          required: ["path", "heading"],
        },
      },
      {
        name: "list_workspace_files",
        description: "List all Markdown files in the workspace with their first line and approximate word count.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "search_workspace") return this.searchWorkspace(String(args.query ?? ""), Number(args.limit ?? 8));
    if (name === "get_workspace_section") return this.getSection(String(args.path ?? ""), String(args.heading ?? ""));
    if (name === "list_workspace_files") return this.listFiles();
    if (name === "fact_check") return this.factCheck(String(args.claim ?? ""));
  }

  // ── Tool implementations ───────────────────────────────────────────────────

  /**
   * Public entry point — called directly on startup and by the agent via executeTool.
   * Incremental: skips files whose (mtime, size) match the stored row.
   * Pass `force: true` to re-extract all files regardless of mtime (needed when
   * the link extraction schema is newer than the last index run).
   * Reads files in parallel batches of 16; calls onProgress after each batch.
   */
  async index(
    onProgress?: (indexed: number, total: number) => void,
    options?: { force?: boolean },
  ): Promise<IndexResult> {
    const force = options?.force ?? false;
    const BATCH_SIZE = 16;
    const glob = new Bun.Glob("**/*.md");
    const files: string[] = [];

    for await (const match of glob.scan({ cwd: this.root, dot: false })) {
      if (!match.startsWith(".episteme")) files.push(match);
    }

    let indexed = 0;
    let skipped = 0;
    let processed = 0;
    const seen = new Set<string>(files);
    const total = files.length;
    const emit = (n: number) => {
      onProgress?.(n, total);
      this.progressListener?.(n, total);
    };

    emit(0);

    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((relPath) => this.indexFile(relPath, files, force)));
      for (const r of results) {
        if (r === "indexed") indexed++;
        else if (r === "skipped") skipped++;
      }
      processed += batch.length;
      emit(processed);
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
      total,
      message: `Indexed ${indexed} (skipped ${skipped} unchanged, deleted ${deleted}).`,
    };
  }

  /** Index one file. Returns the outcome so the batched caller can tally. */
  private async indexFile(
    relPath: string,
    allFiles: string[],
    force = false,
  ): Promise<"indexed" | "skipped" | "failed"> {
    try {
      const absPath = join(this.root, relPath);
      const fileStat = await stat(absPath);
      const mtime = fileStat.mtimeMs;
      const size = fileStat.size;

      const existing = this.workspaceDb.getWorkspaceFile(relPath);
      if (!force && existing && existing.mtime === mtime && existing.size === size) {
        return "skipped";
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

      const links = extractLinksForFile(content, relPath, allFiles);
      this.workspaceDb.replaceFileLinks(relPath, links);

      return "indexed";
    } catch (err) {
      logger.warn(this.name, `Failed to index ${relPath}:`, err);
      return "failed";
    }
  }

  /** FTS-backed workspace search. Returns [] for empty queries. */
  search(query: string, limit: number = 8): WorkspaceSearchHit[] {
    if (!query.trim()) return [];
    return this.workspaceDb.searchWorkspaceFiles(query, limit);
  }

  private searchWorkspace(query: string, limit: number): unknown {
    if (!query.trim()) return { results: [], message: "Empty query." };

    const hits = this.search(query, limit);
    if (hits.length === 0 && this.workspaceDb.listWorkspaceFiles().length === 0) {
      return {
        results: [],
        message:
          "No results. The workspace index is empty — it builds automatically on startup and when the user re-indexes from the command palette.",
      };
    }
    return {
      results: hits.map((h) => ({
        path: h.relPath,
        excerpt: h.excerpt,
        source: "index",
      })),
      query,
    };
  }

  private async getSection(relativePath: string, heading: string): Promise<unknown> {
    if (!relativePath) return { error: "No path provided." };
    if (!heading) return { error: "No heading provided." };

    const absolute = resolve(join(this.root, relativePath));
    if (absolute !== this.root && !absolute.startsWith(this.root + "/")) {
      return { error: "Path escapes workspace boundary." };
    }

    let content: string;
    try {
      content = await Bun.file(absolute).text();
    } catch {
      return { error: `File not found: ${relativePath}` };
    }

    const lines = content.split("\n");
    const normalizedTarget = heading.toLowerCase().trim();
    let startLine = -1;
    let headingLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i]!.match(/^(#{1,6})\s+(.+)$/);
      if (m && m[2]!.trim().toLowerCase().includes(normalizedTarget)) {
        startLine = i;
        headingLevel = m[1]!.length;
        break;
      }
    }

    if (startLine === -1) {
      return { error: `Heading "${heading}" not found in ${relativePath}.` };
    }

    const sectionLines = [lines[startLine]!];
    for (let i = startLine + 1; i < lines.length; i++) {
      const m = lines[i]!.match(/^(#{1,6})\s/);
      if (m && m[1]!.length <= headingLevel) break;
      sectionLines.push(lines[i]!);
    }

    return {
      path: relativePath,
      heading: lines[startLine]!,
      level: headingLevel,
      content: sectionLines.join("\n"),
    };
  }

  private factCheck(claim: string): unknown {
    if (!claim.trim()) return { matches: [], message: "Empty claim." };
    if (this.workspaceDb.listWorkspaceFiles().length === 0) {
      return { matches: [], message: "Workspace index is empty — it builds automatically on startup." };
    }
    const hits = this.workspaceDb.searchWorkspaceFiles(claim, 6);
    return {
      matches: hits.map((h) => ({ path: h.relPath, excerpt: h.excerpt })),
      claim,
      note: "Full contradiction detection available in Phase 5.",
    };
  }

  private listFiles(): unknown {
    const rows = this.workspaceDb.listWorkspaceFiles();
    if (rows.length === 0) {
      return { files: [], message: "Workspace index is empty — it builds automatically on startup." };
    }
    const files = rows.map((r) => ({
      path: r.relPath,
      firstLine: r.firstLine ?? r.relPath,
      words: r.wordCount ?? 0,
    }));
    return { files, total: files.length };
  }

  buildKnowledgeGraph(
    limit: number = DEFAULT_GRAPH_LIMIT,
    offset: number = 0,
  ): GraphData & { pagination: { offset: number; limit: number; totalFiles: number } } {
    const nodes: GraphNode[] = [];
    const links: GraphLink[] = [];
    const nodeIds = new Set<string>();

    const totalFiles = this.workspaceDb.countWorkspaceFiles();
    for (const row of this.workspaceDb.listWorkspaceFileSummaries(limit, offset)) {
      const id = `file:${row.relPath}`;
      const firstLine = row.firstLine?.trim() ?? null;
      const label = firstLine?.startsWith("#")
        ? firstLine.replace(/^#+\s*/, "").slice(0, 50)
        : (row.relPath.split("/").at(-1)?.replace(/\.md$/i, "") ?? row.relPath).slice(0, 50);
      nodes.push({ id, label, type: "workspace-file", file: row.relPath, color: "#5588cc" });
      nodeIds.add(id);
    }

    for (const link of this.workspaceDb.getAllLinks()) {
      const src = `file:${link.sourcePath}`;
      const tgt = `file:${link.targetPath}`;
      if (!nodeIds.has(src) || !nodeIds.has(tgt) || src === tgt) continue;
      links.push({ source: src, target: tgt, linkType: "document-link", color: "#55cc88" });
    }

    return { nodes, links, pagination: { offset, limit, totalFiles } };
  }
}

/**
 * Extract resolved relative markdown links from `content`. Each href is
 * resolved against the source file's directory using the workspace file list,
 * so `[foo](./notes/foo.md)` produces `targetPath = "notes/foo.md"` when that
 * file exists.
 */
function extractLinksForFile(
  content: string,
  sourcePath: string,
  allFiles: string[],
): Omit<FileLinkRow, "sourcePath">[] {
  const links: Omit<FileLinkRow, "sourcePath">[] = [];

  for (const m of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = (m[1] ?? "").trim();
    if (!href) continue;
    const target = resolveLocalHref(href, sourcePath, allFiles);
    if (target) {
      links.push({ targetPath: target, linkType: "markdown", raw: href });
    }
  }

  return links;
}
