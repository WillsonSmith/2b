import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import { DocumentDatabase } from "./DocumentDatabase.ts";
import type { CortexMemoryDatabase } from "./CortexMemoryDatabase.ts";
import { logger } from "../logger.ts";
import { resolve, relative, isAbsolute } from "node:path";
import { unlink, mkdir } from "node:fs/promises";

export class DocumentManagerPlugin implements AgentPlugin {
  name = "DocumentManager";

  private llm: LLMProvider;
  private notesDir: string;
  private activeDocumentPath: string | null = null;
  private primaryDocumentPath: string | null = null;
  private contextDocuments: Map<string, string> = new Map();
  private loadedPaths: Set<string> = new Set();
  private documentDatabase: DocumentDatabase;
  private cortexMemoryDb: CortexMemoryDatabase | null = null;
  private broadcastCallback: ((msg: Record<string, unknown>) => void) | null = null;
  private openedDocuments: Map<string, { title: string }> = new Map();
  private userEditCallback: ((path: string, diff: string) => void) | null = null;

  constructor(llm: LLMProvider, notesDir: string = "./notes") {
    this.llm = llm;
    this.notesDir = notesDir;
    this.documentDatabase = new DocumentDatabase("data/documents.sqlite");
    this.ensureNotesDirExists();
  }

  public setBroadcastCallback(fn: (msg: Record<string, unknown>) => void): void {
    this.broadcastCallback = fn;
  }

  public setUserEditCallback(fn: (path: string, diff: string) => void): void {
    this.userEditCallback = fn;
  }

  public async setPrimaryDocument(path: string): Promise<void> {
    this.primaryDocumentPath = path;
    this.broadcastCallback?.({
      type: "document_list",
      documents: this._buildDocumentList(),
    });
  }

  public async applyExternalEdit(path: string, content: string): Promise<void> {
    let oldContent = "";
    try {
      oldContent = await this.readFile(path);
    } catch {}
    await this.writeFile(path, content);
    this._regenerateSummary(path).catch(() => {});
    this._reindexChunks(path).catch(() => {});
    if (this.userEditCallback) {
      const diff = this._describeDiff(path, oldContent, content);
      this.userEditCallback(path, diff);
    }
  }

  private _describeDiff(path: string, oldContent: string, newContent: string): string {
    const filename = path.split("/").pop() ?? path;
    const oldBody = this.stripFrontmatter(oldContent);
    const newBody = this.stripFrontmatter(newContent);

    const sectionPattern = /^(#{1,6}\s+.+)$/m;
    const splitSections = (text: string): Map<string, string[]> => {
      const sections = new Map<string, string[]>();
      let currentSection = "__root__";
      for (const line of text.split("\n")) {
        if (sectionPattern.test(line)) {
          currentSection = line.trim();
          if (!sections.has(currentSection)) sections.set(currentSection, []);
        } else {
          if (!sections.has(currentSection)) sections.set(currentSection, []);
          sections.get(currentSection)!.push(line);
        }
      }
      return sections;
    };

    const oldSections = splitSections(oldBody);
    const newSections = splitSections(newBody);
    const allSections = new Set([...oldSections.keys(), ...newSections.keys()]);

    const parts: string[] = [];
    for (const section of allSections) {
      const oldLines = oldSections.get(section) ?? [];
      const newLines = newSections.get(section) ?? [];
      const added = newLines.length - oldLines.length;
      if (added === 0) continue;
      const label = section === "__root__" ? "document body" : `'${section}'`;
      if (added > 0) parts.push(`Added ~${added} lines to ${label}`);
      else parts.push(`Removed ~${Math.abs(added)} lines from ${label}`);
    }

    if (parts.length === 0) {
      const totalOld = oldBody.split("\n").length;
      const totalNew = newBody.split("\n").length;
      const delta = totalNew - totalOld;
      if (delta > 0) parts.push(`Added ~${delta} lines`);
      else if (delta < 0) parts.push(`Removed ~${Math.abs(delta)} lines`);
      else parts.push("Minor edits (no line count change)");
    }

    return `User edited ${filename}: ${parts.join(". ")}.`;
  }

  public async getDocumentListMessage(): Promise<Record<string, unknown>> {
    return { type: "document_list", documents: this._buildDocumentList() };
  }

  public async getAllDocumentsMessage(): Promise<Record<string, unknown>> {
    const rows = this.documentDatabase.getAllDocuments();
    return {
      type: "all_documents",
      documents: rows.map((r) => ({ path: r.path, title: r.title, summary: r.summary ?? undefined })),
    };
  }

  public async renameDocument(path: string, newTitle: string): Promise<void> {
    try {
      const content = await this.readFile(path);
      const { frontmatter, body } = this.parseFrontmatter(content);
      frontmatter.title = newTitle;
      await this.writeFile(path, this.serializeFrontmatter(frontmatter) + "\n" + body);
      this.documentDatabase.updateTitle(path, newTitle);
      if (this.openedDocuments.has(path)) {
        this.openedDocuments.set(path, { title: newTitle });
      }
      this.broadcastCallback?.({ type: "document_renamed", path, newTitle });
    } catch (e) {
      logger.error("DocumentManager", "renameDocument error:", e);
    }
  }

  public async deleteDocument(path: string): Promise<void> {
    try {
      const safePath = this.resolveSafePath(path);
      await unlink(safePath).catch(() => {});
      this.documentDatabase.deleteDocument(path);
      this.openedDocuments.delete(path);
      if (this.activeDocumentPath === path) this.activeDocumentPath = null;
      if (this.primaryDocumentPath === path) this.primaryDocumentPath = null;
      this.loadedPaths.delete(path);
      this.contextDocuments.delete(path);
      this.broadcastCallback?.({ type: "document_deleted", path });
    } catch (e) {
      logger.error("DocumentManager", "deleteDocument error:", e);
    }
  }

  private _buildDocumentList(): Array<{ path: string; title: string; active: boolean }> {
    const docs: Array<{ path: string; title: string; active: boolean }> = [];
    for (const [path, info] of this.openedDocuments) {
      docs.push({ path, title: info.title, active: path === this.activeDocumentPath });
    }
    return docs;
  }

  private async _trackAndBroadcastOpened(path: string): Promise<void> {
    if (!this.broadcastCallback) return;
    try {
      const content = await this.readFile(path);
      const { frontmatter } = this.parseFrontmatter(content);
      const title = String(frontmatter.title ?? path.split("/").pop()?.replace(".md", "") ?? path);
      this.openedDocuments.set(path, { title });
      this.broadcastCallback({ type: "document_opened", path, title, content });
      this.broadcastCallback({ type: "document_list", documents: this._buildDocumentList() });
    } catch {}
  }

  private async _broadcastUpdated(path: string, content: string): Promise<void> {
    if (!this.broadcastCallback) return;
    this.broadcastCallback({ type: "document_updated", path, content });
  }

  /** Optionally inject the CortexMemoryDatabase for regeneration from memories. */
  public setCortexMemoryDb(db: CortexMemoryDatabase): void {
    this.cortexMemoryDb = db;
  }

  private async ensureNotesDirExists(): Promise<void> {
    try {
      await mkdir(resolve(this.notesDir), { recursive: true });
    } catch {}
  }

  // ──────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────

  private slugify(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  private buildFrontmatter(
    title: string,
    tags: string[],
    created: string,
  ): string {
    return [
      "---",
      `title: ${title}`,
      `tags: [${tags.join(", ")}]`,
      `summary: ""`,
      `created: ${created}`,
      `links: []`,
      "---",
    ].join("\n");
  }

  /** Resolve filePath and assert it stays within notesDir. Returns the resolved absolute path. */
  private resolveSafePath(filePath: string): string {
    const base = resolve(this.notesDir);
    const resolved = resolve(filePath);
    const rel = relative(base, resolved);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Access denied: path is outside the notes directory.");
    }
    return resolved;
  }

  private async readFile(filePath: string): Promise<string> {
    return await Bun.file(this.resolveSafePath(filePath)).text();
  }

  private async writeFile(filePath: string, content: string): Promise<void> {
    await Bun.write(this.resolveSafePath(filePath), content);
  }

  private parseFrontmatter(content: string): {
    frontmatter: Record<string, any>;
    body: string;
  } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) return { frontmatter: {}, body: content };

    const fm: Record<string, any> = {};
    for (const line of (match[1] ?? "").split("\n")) {
      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      // Simple array parsing for links/tags (YAML array format)
      if (val.startsWith("[")) {
        fm[key] = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      } else {
        fm[key] = val.replace(/^"(.*)"$/, "$1");
      }
    }
    return { frontmatter: fm, body: match[2] ?? "" };
  }

  private serializeFrontmatter(fm: Record<string, any>): string {
    const lines = ["---"];
    for (const [key, value] of Object.entries(fm)) {
      if (Array.isArray(value)) {
        lines.push(`${key}: [${value.join(", ")}]`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    lines.push("---");
    return lines.join("\n");
  }

  private stripFrontmatter(content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  }

  private chunkText(text: string): string[] {
    const rawChunks = text.split(/\n\n+/);
    const merged: string[] = [];
    for (const chunk of rawChunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      if (merged.length > 0 && merged[merged.length - 1]!.length < 100) {
        merged[merged.length - 1] += "\n\n" + trimmed;
      } else {
        merged.push(trimmed);
      }
    }
    const result: string[] = [];
    for (const chunk of merged) {
      if (chunk.length <= 800) {
        result.push(chunk);
      } else {
        // Split on sentence boundaries if possible
        const sentences = chunk.match(/[^.!?]+[.!?]+/g) ?? [];
        if (sentences.length > 1) {
          let current = "";
          for (const sentence of sentences) {
            if ((current + sentence).length > 800 && current.length > 0) {
              result.push(current.trim());
              current = sentence;
            } else {
              current += sentence;
            }
          }
          if (current.trim()) result.push(current.trim());
        } else {
          // Hard split
          for (let i = 0; i < chunk.length; i += 800) {
            result.push(chunk.slice(i, i + 800));
          }
        }
      }
    }
    return result;
  }

  async _reindexChunks(documentPath: string): Promise<void> {
    try {
      const content = await this.readFile(documentPath);
      const body = this.stripFrontmatter(content);
      const chunks = this.chunkText(body);
      if (chunks.length === 0) return;
      const chunkData = await Promise.all(
        chunks.map(async (text) => ({ text, embedding: await this.llm.getEmbedding(text) })),
      );
      await this.documentDatabase.upsertChunks(documentPath, chunkData);
    } catch (e) {
      logger.error("DocumentManager", "Failed to reindex chunks:", e);
    }
  }

  async _createVersion(documentPath: string): Promise<void> {
    try {
      const content = await this.readFile(documentPath);
      await this.documentDatabase.saveVersion(documentPath, content);
    } catch (e) {
      logger.error("DocumentManager", "Failed to create version:", e);
    }
  }

  async _regenerateSummary(documentPath: string): Promise<void> {
    try {
      const content = await this.readFile(documentPath);
      const body = this.stripFrontmatter(content);
      const { nonReasoningContent } = await this.llm.chat(
        [
          {
            role: "user",
            content: `Summarize this document in 2-3 sentences:\n\n${body}`,
          },
        ],
        "",
      );
      const summary = nonReasoningContent.trim();

      // Update frontmatter
      const { frontmatter, body: docBody } = this.parseFrontmatter(content);
      frontmatter.summary = `"${summary}"`;
      const newContent =
        this.serializeFrontmatter(frontmatter) + "\n" + docBody;
      await this.writeFile(documentPath, newContent);
      await this.documentDatabase.updateSummary(documentPath, summary);
    } catch (e) {
      logger.error("DocumentManager", "Failed to regenerate summary:", e);
    }
  }

  async _embedDocument(documentPath: string): Promise<void> {
    try {
      const content = await this.readFile(documentPath);
      const body = this.stripFrontmatter(content);
      const { frontmatter } = this.parseFrontmatter(content);
      const textToEmbed = `${frontmatter.title ?? ""}\n${body}`;
      const embedding = await this.llm.getEmbedding(textToEmbed);
      await this.documentDatabase.updateEmbedding(documentPath, embedding);
    } catch (e) {
      logger.error("DocumentManager", "Failed to embed document:", e);
    }
  }

  // ──────────────────────────────────────────────
  // Plugin interface
  // ──────────────────────────────────────────────

  getSystemPromptFragment(): string {
    const active = this.activeDocumentPath
      ? `Active document: ${this.activeDocumentPath}`
      : "No active document.";
    const primary = this.primaryDocumentPath
      ? `User's preferred document: ${this.primaryDocumentPath} (prefer editing this one when relevant)`
      : "";

    return [
      "## Document Management",
      active,
      primary,
      "After every meaningful exchange, decide whether to: create a new document, edit an existing one, link documents, or take no action.",
      "Before creating a new document, always search_documents to avoid duplicates.",
      "Use add_section for new content (no versioning). Use edit_section for updates (triggers versioning).",
      "Keep notes concise and well-structured. Use markdown headings for sections.",
    ].filter(Boolean).join("\n");
  }

  async getContext(): Promise<string> {
    const parts: string[] = [];

    // Active document full content (if under ~2000 chars as proxy for tokens)
    if (this.activeDocumentPath) {
      try {
        const content = await this.readFile(this.activeDocumentPath);
        if (content.length < 8000) {
          parts.push(
            `## Active Document: ${this.activeDocumentPath}\n${content}`,
          );
        } else {
          const { frontmatter } = this.parseFrontmatter(content);
          parts.push(
            `## Active Document: ${this.activeDocumentPath}\n(Too large to display fully. Summary: ${frontmatter.summary ?? "none"})`,
          );
        }
      } catch {}
    }

    // Context document summaries
    for (const [path, summary] of this.contextDocuments) {
      parts.push(`## Context: ${path}\nSummary: ${summary}`);
    }

    // Loaded documents (full content)
    for (const path of this.loadedPaths) {
      if (path === this.activeDocumentPath) continue;
      try {
        const content = await this.readFile(path);
        parts.push(`## Loaded Document: ${path}\n${content}`);
      } catch {}
    }

    return parts.join("\n\n");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "create_document",
        description: "Create a new markdown document with frontmatter.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string" },
            initial_content: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
          required: ["title", "initial_content", "tags"],
        },
      },
      {
        name: "edit_section",
        description:
          "Edit an existing section in a document. Triggers versioning if the section exists.",
        parameters: {
          type: "object",
          properties: {
            document_path: { type: "string" },
            section_heading: { type: "string" },
            new_content: { type: "string" },
          },
          required: ["document_path", "section_heading", "new_content"],
        },
      },
      {
        name: "add_section",
        description:
          "Append a new section to a document. Does not trigger versioning.",
        parameters: {
          type: "object",
          properties: {
            document_path: { type: "string" },
            section_heading: { type: "string" },
            content: { type: "string" },
          },
          required: ["document_path", "section_heading", "content"],
        },
      },
      {
        name: "link_documents",
        description: "Add a bidirectional link between two documents.",
        parameters: {
          type: "object",
          properties: {
            path_a: { type: "string" },
            path_b: { type: "string" },
          },
          required: ["path_a", "path_b"],
        },
      },
      {
        name: "set_active_document",
        description: "Set the active document for this session.",
        parameters: {
          type: "object",
          properties: {
            document_path: { type: "string" },
          },
          required: ["document_path"],
        },
      },
      {
        name: "search_documents",
        description:
          "Search documents by semantic similarity at the passage level. Returns top 5 results with the matching passage and document path.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
      {
        name: "load_document_context",
        description:
          "Load a document's content into the current context window. Optionally filter to specific sections.",
        parameters: {
          type: "object",
          properties: {
            document_path: { type: "string" },
            sections: {
              type: "array",
              items: { type: "string" },
              description: "Optional section names or keywords. If provided, loads only matching sections.",
            },
          },
          required: ["document_path"],
        },
      },
      {
        name: "get_document_versions",
        description: "List saved versions for a document.",
        parameters: {
          type: "object",
          properties: {
            document_path: { type: "string" },
          },
          required: ["document_path"],
        },
      },
      {
        name: "restore_version",
        description:
          "Restore a document to a specific version (versions current state first).",
        parameters: {
          type: "object",
          properties: {
            document_path: { type: "string" },
            version_id: { type: "string" },
          },
          required: ["document_path", "version_id"],
        },
      },
      {
        name: "regenerate_document_from_memories",
        description:
          "Rewrite a document's content from related memories in the Cortex memory database.",
        parameters: {
          type: "object",
          properties: {
            document_path: { type: "string" },
          },
          required: ["document_path"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    try {
      if (name === "create_document") return await this._createDocument(args);
      if (name === "edit_section") return await this._editSection(args);
      if (name === "add_section") return await this._addSection(args);
      if (name === "link_documents") return await this._linkDocuments(args);
      if (name === "set_active_document")
        return await this._setActiveDocument(args);
      if (name === "search_documents") return await this._searchDocuments(args);
      if (name === "load_document_context")
        return await this._loadDocumentContext(args);
      if (name === "get_document_versions")
        return await this._getDocumentVersions(args);
      if (name === "restore_version") return await this._restoreVersion(args);
      if (name === "regenerate_document_from_memories")
        return await this._regenerateFromMemories(args);
    } catch (e) {
      logger.error("DocumentManager", `Tool error (${name}):`, e);
      const msg = e instanceof Error ? e.message : String(e);
      // Surface access-denied messages; mask all other internal details
      if (msg.startsWith("Access denied")) return `Error: ${msg}`;
      return "Error: operation failed.";
    }
  }

  // ──────────────────────────────────────────────
  // Tool implementations
  // ──────────────────────────────────────────────

  private async _createDocument(args: {
    title: string;
    initial_content: string;
    tags: string[];
  }): Promise<string> {
    const slug = this.slugify(args.title);
    const filePath = `${this.notesDir}/${slug}.md`;
    const now = new Date().toISOString();
    const frontmatter = this.buildFrontmatter(args.title, args.tags, now);
    const content = `${frontmatter}\n\n${args.initial_content}`;
    await this.writeFile(filePath, content);

    // Store in DB
    await this.documentDatabase.upsertDocument(
      filePath,
      args.title,
      null,
      null,
      args.tags,
    );

    // Embed async (don't block)
    this._embedDocument(filePath).catch(() => {});
    this._reindexChunks(filePath).catch(() => {});

    this.activeDocumentPath = filePath;
    await this._trackAndBroadcastOpened(filePath);
    this.broadcastCallback?.({ type: "document_ai_active", path: filePath });
    return `Document created: ${filePath}`;
  }

  private async _findSimilarFiles(requestedPath: string): Promise<string> {
    const glob = new Bun.Glob("**/*.md");
    const files: string[] = [];
    for await (const file of glob.scan(this.notesDir)) {
      files.push(`${this.notesDir}/${file}`);
    }
    if (files.length === 0) return "No documents found in notes directory.";

    // Score by character overlap with the requested filename
    const requestedBase = requestedPath.split("/").pop() ?? requestedPath;
    const scored = files.map((f) => {
      const base = f.split("/").pop() ?? f;
      let overlap = 0;
      for (const ch of base) if (requestedBase.includes(ch)) overlap++;
      return {
        path: f,
        score: overlap / Math.max(base.length, requestedBase.length),
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const suggestions = scored
      .slice(0, 5)
      .map((s) => `  - ${s.path}`)
      .join("\n");
    return `File not found: "${requestedPath}". Did you mean one of these?\n${suggestions}`;
  }

  private async _editSection(args: {
    document_path: string;
    section_heading: string;
    new_content: string;
  }): Promise<string> {
    let content: string;
    try {
      content = await this.readFile(args.document_path);
    } catch (e: any) {
      if (e?.code === "ENOENT")
        return await this._findSimilarFiles(args.document_path);
      throw e;
    }
    const now = new Date().toISOString();
    const headingPattern = new RegExp(
      `(#{1,6}\\s+${args.section_heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?)(?=\\n#{1,6}\\s|$)`,
    );

    if (headingPattern.test(content)) {
      // Section exists — version first
      await this._createVersion(args.document_path);

      const updated = content.replace(
        headingPattern,
        `$1<!-- last_modified: ${now} -->\n${args.new_content}\n`,
      );
      await this.writeFile(args.document_path, updated);
    } else {
      // Section doesn't exist — add it
      const timestamp = `<!-- added: ${now} -->`;
      const newSection = `\n\n## ${args.section_heading}\n${timestamp}\n${args.new_content}`;
      await this.writeFile(args.document_path, content + newSection);
    }

    this.broadcastCallback?.({ type: "document_ai_active", path: args.document_path });
    await this._embedDocument(args.document_path);
    await this._regenerateSummary(args.document_path);
    this._reindexChunks(args.document_path).catch(() => {});
    const finalContent = await this.readFile(args.document_path);
    await this._broadcastUpdated(args.document_path, finalContent);
    this.broadcastCallback?.({ type: "document_ai_active", path: this.activeDocumentPath });
    return `Section "${args.section_heading}" updated in ${args.document_path}.`;
  }

  private async _addSection(args: {
    document_path: string;
    section_heading: string;
    content: string;
  }): Promise<string> {
    let existing: string;
    try {
      existing = await this.readFile(args.document_path);
    } catch (e: any) {
      if (e?.code === "ENOENT")
        return await this._findSimilarFiles(args.document_path);
      throw e;
    }
    const now = new Date().toISOString();
    const newSection = `\n\n## ${args.section_heading}\n<!-- added: ${now} -->\n${args.content}`;
    await this.writeFile(args.document_path, existing + newSection);
    this.broadcastCallback?.({ type: "document_ai_active", path: args.document_path });
    await this._embedDocument(args.document_path);
    this._reindexChunks(args.document_path).catch(() => {});
    await this._broadcastUpdated(args.document_path, existing + newSection);
    this.broadcastCallback?.({ type: "document_ai_active", path: this.activeDocumentPath });
    return `Section "${args.section_heading}" added to ${args.document_path}.`;
  }

  private async _linkDocuments(args: {
    path_a: string;
    path_b: string;
  }): Promise<string> {
    const addLink = async (filePath: string, linkTarget: string) => {
      const content = await this.readFile(filePath);
      const { frontmatter, body } = this.parseFrontmatter(content);
      const links: string[] = Array.isArray(frontmatter.links)
        ? frontmatter.links
        : [];
      if (!links.includes(linkTarget)) {
        links.push(linkTarget);
        frontmatter.links = `[${links.join(", ")}]`;
        await this.writeFile(
          filePath,
          this.serializeFrontmatter(frontmatter) + "\n" + body,
        );
      }
    };

    await addLink(args.path_a, args.path_b);
    await addLink(args.path_b, args.path_a);
    return `Linked ${args.path_a} ↔ ${args.path_b}.`;
  }

  private async _setActiveDocument(args: {
    document_path: string;
  }): Promise<string> {
    this.activeDocumentPath = args.document_path;
    this.loadedPaths.add(args.document_path);
    await this._trackAndBroadcastOpened(args.document_path);
    this.broadcastCallback?.({ type: "document_ai_active", path: args.document_path });
    return `Active document set to ${args.document_path}.`;
  }

  private async _searchDocuments(args: { query: string }): Promise<string> {
    const queryEmbedding = await this.llm.getEmbedding(args.query);
    const chunkResults = await this.documentDatabase.searchChunks(queryEmbedding, 20, 0.4);

    if (chunkResults.length === 0) {
      // Fall back to whole-document search
      const docResults = await this.documentDatabase.search(queryEmbedding, 5);
      if (docResults.length === 0) return "No matching documents found.";
      return docResults
        .map((r) => `- **${r.title}** (${r.path}) — score: ${r.score.toFixed(2)}\n  ${r.summary ?? "No summary"}`)
        .join("\n");
    }

    // Deduplicate by documentPath, keeping highest-scoring chunk
    const best = new Map<string, { score: number; text: string }>();
    for (const r of chunkResults) {
      const existing = best.get(r.documentPath);
      if (!existing || r.score > existing.score) {
        best.set(r.documentPath, { score: r.score, text: r.text });
      }
    }

    // Look up titles from documents table
    const docRows = this.documentDatabase.getDocumentsByPaths([...best.keys()]);
    const titleMap = new Map<string, string>(docRows.map((d) => [d.path, d.title]));

    const sorted = [...best.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, 5);
    return sorted
      .map(([path, { score, text }]) => {
        const title = titleMap.get(path) ?? path.split("/").pop() ?? path;
        return `- **${title}** (${path}) — score: ${score.toFixed(2)}\n  Passage: "${text.slice(0, 200)}${text.length > 200 ? "…" : ""}"`;
      })
      .join("\n");
  }

  private async _loadDocumentContext(args: {
    document_path: string;
    sections?: string[];
  }): Promise<string> {
    this.loadedPaths.add(args.document_path);
    await this._trackAndBroadcastOpened(args.document_path);
    if (!args.sections || args.sections.length === 0) {
      return `Document ${args.document_path} loaded into context.`;
    }
    try {
      const content = await this.readFile(args.document_path);
      const body = this.stripFrontmatter(content);
      const lines = body.split("\n");
      const matchedSections: string[] = [];
      let capturing = false;
      let currentSection: string[] = [];
      let currentHeading = "";

      for (const line of lines) {
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
          if (capturing && currentSection.length > 0) {
            matchedSections.push(`${currentHeading}\n${currentSection.join("\n")}`);
          }
          currentHeading = line;
          currentSection = [];
          const headingText = headingMatch[2]!.toLowerCase();
          capturing = args.sections.some((s) => headingText.includes(s.toLowerCase()));
        } else if (capturing) {
          currentSection.push(line);
        }
      }
      if (capturing && currentSection.length > 0) {
        matchedSections.push(`${currentHeading}\n${currentSection.join("\n")}`);
      }

      if (matchedSections.length === 0) {
        return `Document ${args.document_path} loaded. No sections matched: ${args.sections.join(", ")}.`;
      }
      return `Sections from ${args.document_path}:\n\n${matchedSections.join("\n\n")}`;
    } catch {
      return `Document ${args.document_path} loaded into context.`;
    }
  }

  private async _getDocumentVersions(args: {
    document_path: string;
  }): Promise<string> {
    const versions = await this.documentDatabase.getVersions(
      args.document_path,
    );
    if (versions.length === 0) return "No versions saved.";
    return versions
      .map((v) => `- ${v.id} — ${new Date(v.timestamp).toISOString()}`)
      .join("\n");
  }

  private async _restoreVersion(args: {
    document_path: string;
    version_id: string;
  }): Promise<string> {
    // Version the current state first
    await this._createVersion(args.document_path);

    const version = await this.documentDatabase.getVersion(args.version_id);
    if (!version) return `Version ${args.version_id} not found.`;

    await this.writeFile(args.document_path, version.content);
    await this._embedDocument(args.document_path);
    this._reindexChunks(args.document_path).catch(() => {});
    return `Restored ${args.document_path} to version from ${new Date(version.timestamp).toISOString()}.`;
  }

  private async _regenerateFromMemories(args: {
    document_path: string;
  }): Promise<string> {
    if (!this.cortexMemoryDb) {
      return "CortexMemoryDatabase not available. Call setCortexMemoryDb() first.";
    }

    const content = await this.readFile(args.document_path);
    const { frontmatter } = this.parseFrontmatter(content);
    const topic = String(frontmatter.title ?? args.document_path);

    const memories = await this.cortexMemoryDb.search(topic, 10, 0.4);
    if (memories.length === 0) return "No relevant memories found.";

    const memoryText = memories.map((m) => `- ${m.text}`).join("\n");
    const prompt = `Rewrite this document based on the following memories. Keep the original frontmatter.\n\nMemories:\n${memoryText}\n\nOriginal document:\n${content}`;

    const { nonReasoningContent: rewritten } = await this.llm.chat(
      [{ role: "user", content: prompt }],
      "",
    );

    await this._createVersion(args.document_path);
    await this.writeFile(args.document_path, rewritten);
    await this._embedDocument(args.document_path);
    return `Document ${args.document_path} regenerated from ${memories.length} memories.`;
  }
}
