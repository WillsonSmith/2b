import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export interface WorkspaceFileRow {
  relPath: string;
  content: string;
  mtime: number;
  size: number;
  contentHash: string;
  firstLine: string | null;
  wordCount: number | null;
  indexedAt: number;
}

export interface WorkspaceSearchHit {
  relPath: string;
  firstLine: string | null;
  wordCount: number | null;
  excerpt: string;
}

export interface WorkspaceFileSummary {
  relPath: string;
  firstLine: string | null;
  wordCount: number | null;
}

export interface FileLinkRow {
  sourcePath: string;
  targetPath: string;
  linkType: "wikilink" | "markdown";
  raw: string;
}

export interface ContradictionRow {
  id: string;
  summary: string;
  sourceAId: string;
  sourceBId: string;
  sourceAText: string;
  sourceBText: string;
  createdAt: number;
}

export interface IngestedUrlRow {
  url: string;
  slug: string;
  summary: string;
  filePath: string;
  fetchedAt: number;
}

export interface IngestedPdfRow {
  relPath: string;
  structuredContent: string;
  filePath: string;
  ingestedAt: number;
}

interface WsFileRecord {
  rel_path: string;
  content: string;
  mtime: number;
  size: number;
  content_hash: string;
  first_line: string | null;
  word_count: number | null;
  indexed_at: number;
}

interface WsLinkRecord {
  source_path: string;
  target_path: string;
  link_type: string;
  raw: string | null;
}

interface ContradictionRecord {
  id: string;
  summary: string;
  source_a_id: string;
  source_b_id: string;
  source_a_text: string;
  source_b_text: string;
  created_at: number;
}

interface IngestedUrlRecord {
  url: string;
  slug: string;
  summary: string;
  file_path: string;
  fetched_at: number;
}

interface IngestedPdfRecord {
  rel_path: string;
  structured_content: string;
  file_path: string;
  ingested_at: number;
}

const SCHEMA_VERSION = 3;

/**
 * Structural data store for the Episteme workspace: files, link edges,
 * contradiction records, and ingestion metadata. Lives alongside the
 * CortexMemoryDatabase tables in the same SQLite file but owns its own
 * `Database` connection (WAL mode handles concurrent intra-process access).
 */
export class WorkspaceDb {
  private db: Database;

  // Prepared statements for hot paths.
  private stmtUpsertFile!: ReturnType<Database["prepare"]>;
  private stmtGetFile!: ReturnType<Database["prepare"]>;
  private stmtListFiles!: ReturnType<Database["prepare"]>;
  private stmtListFileSummaries!: ReturnType<Database["prepare"]>;
  private stmtCountFiles!: ReturnType<Database["prepare"]>;
  private stmtDeleteFile!: ReturnType<Database["prepare"]>;
  private stmtSearchFiles!: ReturnType<Database["prepare"]>;
  private stmtDeleteLinks!: ReturnType<Database["prepare"]>;
  private stmtInsertLink!: ReturnType<Database["prepare"]>;
  private stmtGetOutboundLinks!: ReturnType<Database["prepare"]>;
  private stmtGetAllLinks!: ReturnType<Database["prepare"]>;
  private stmtRecordContradiction!: ReturnType<Database["prepare"]>;
  private stmtListContradictions!: ReturnType<Database["prepare"]>;
  private stmtPairExists!: ReturnType<Database["prepare"]>;
  private stmtRecordUrl!: ReturnType<Database["prepare"]>;
  private stmtGetUrl!: ReturnType<Database["prepare"]>;
  private stmtListUrls!: ReturnType<Database["prepare"]>;
  private stmtRecordPdf!: ReturnType<Database["prepare"]>;
  private stmtGetPdf!: ReturnType<Database["prepare"]>;
  private stmtListPdfs!: ReturnType<Database["prepare"]>;
  private stmtGetMeta!: ReturnType<Database["prepare"]>;
  private stmtSetMeta!: ReturnType<Database["prepare"]>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.run("PRAGMA foreign_keys = ON");
    this.db.run("PRAGMA journal_mode = WAL");
    this.initSchema();
    this.prepareStatements();
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ws_schema_version (
        version INTEGER NOT NULL
      )
    `);
    const existing = this.db
      .query<{ version: number }, []>("SELECT version FROM ws_schema_version LIMIT 1")
      .get();
    const previousVersion = existing?.version ?? 0;
    if (!existing) {
      this.db.run("INSERT INTO ws_schema_version (version) VALUES (?)", [SCHEMA_VERSION]);
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ws_files (
        rel_path      TEXT PRIMARY KEY,
        content       TEXT NOT NULL,
        mtime         INTEGER NOT NULL,
        size          INTEGER NOT NULL,
        content_hash  TEXT NOT NULL,
        first_line    TEXT,
        word_count    INTEGER,
        indexed_at    INTEGER NOT NULL
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_ws_files_indexed_at ON ws_files(indexed_at)",
    );

    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ws_files_fts USING fts5(
        rel_path,
        first_line,
        content,
        tokenize = 'porter unicode61'
      )
    `);
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS ws_files_ai AFTER INSERT ON ws_files BEGIN
        INSERT INTO ws_files_fts(rowid, rel_path, first_line, content)
        VALUES (new.rowid, new.rel_path, new.first_line, new.content);
      END
    `);
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS ws_files_ad AFTER DELETE ON ws_files BEGIN
        DELETE FROM ws_files_fts WHERE rowid = old.rowid;
      END
    `);
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS ws_files_au AFTER UPDATE ON ws_files BEGIN
        DELETE FROM ws_files_fts WHERE rowid = old.rowid;
        INSERT INTO ws_files_fts(rowid, rel_path, first_line, content)
        VALUES (new.rowid, new.rel_path, new.first_line, new.content);
      END
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ws_file_links (
        source_path   TEXT NOT NULL,
        target_path   TEXT NOT NULL,
        link_type     TEXT NOT NULL,
        raw           TEXT,
        PRIMARY KEY (source_path, target_path, link_type),
        FOREIGN KEY (source_path) REFERENCES ws_files(rel_path) ON DELETE CASCADE
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_ws_file_links_target ON ws_file_links(target_path)",
    );

    // Logical FK: source_a_id / source_b_id reference CortexMemoryDatabase.memories.id
    // (sibling table owned by a different module — not enforced).
    this.db.run(`
      CREATE TABLE IF NOT EXISTS contradictions (
        id            TEXT PRIMARY KEY,
        summary       TEXT NOT NULL,
        source_a_id   TEXT NOT NULL,
        source_b_id   TEXT NOT NULL,
        source_a_text TEXT NOT NULL,
        source_b_text TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      )
    `);
    this.db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_contradictions_pair ON contradictions(source_a_id, source_b_id)",
    );

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ingested_urls (
        url           TEXT PRIMARY KEY,
        slug          TEXT NOT NULL,
        summary       TEXT NOT NULL,
        file_path     TEXT NOT NULL,
        fetched_at    INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ingested_pdfs (
        rel_path           TEXT PRIMARY KEY,
        structured_content TEXT NOT NULL,
        file_path          TEXT NOT NULL,
        ingested_at        INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ws_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    if (previousVersion > 0 && previousVersion < 2) {
      this.db.run(`
        INSERT INTO ws_files_fts(rowid, rel_path, first_line, content)
        SELECT rowid, rel_path, first_line, content FROM ws_files
      `);
    }
    if (previousVersion > 0 && previousVersion < SCHEMA_VERSION) {
      this.db.run("UPDATE ws_schema_version SET version = ?", [SCHEMA_VERSION]);
    }
  }

  private prepareStatements(): void {
    this.stmtUpsertFile = this.db.prepare(`
      INSERT INTO ws_files (rel_path, content, mtime, size, content_hash, first_line, word_count, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rel_path) DO UPDATE SET
        content = excluded.content,
        mtime = excluded.mtime,
        size = excluded.size,
        content_hash = excluded.content_hash,
        first_line = excluded.first_line,
        word_count = excluded.word_count,
        indexed_at = excluded.indexed_at
    `);
    this.stmtGetFile = this.db.prepare("SELECT * FROM ws_files WHERE rel_path = ?");
    this.stmtListFiles = this.db.prepare("SELECT * FROM ws_files ORDER BY rel_path");
    this.stmtListFileSummaries = this.db.prepare(`
      SELECT rel_path, first_line, word_count
      FROM ws_files
      ORDER BY rel_path
      LIMIT ? OFFSET ?
    `);
    this.stmtCountFiles = this.db.prepare("SELECT COUNT(*) AS c FROM ws_files");
    this.stmtDeleteFile = this.db.prepare("DELETE FROM ws_files WHERE rel_path = ?");
    this.stmtSearchFiles = this.db.prepare(`
      SELECT
        ws_files.rel_path   AS rel_path,
        ws_files.first_line AS first_line,
        ws_files.word_count AS word_count,
        snippet(ws_files_fts, -1, '', '', '…', 12) AS excerpt
      FROM ws_files_fts
      JOIN ws_files ON ws_files.rowid = ws_files_fts.rowid
      WHERE ws_files_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    this.stmtDeleteLinks = this.db.prepare("DELETE FROM ws_file_links WHERE source_path = ?");
    this.stmtInsertLink = this.db.prepare(`
      INSERT OR IGNORE INTO ws_file_links (source_path, target_path, link_type, raw)
      VALUES (?, ?, ?, ?)
    `);
    this.stmtGetOutboundLinks = this.db.prepare(
      "SELECT * FROM ws_file_links WHERE source_path = ?",
    );
    this.stmtGetAllLinks = this.db.prepare("SELECT * FROM ws_file_links");

    this.stmtRecordContradiction = this.db.prepare(`
      INSERT INTO contradictions (id, summary, source_a_id, source_b_id, source_a_text, source_b_text, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_a_id, source_b_id) DO UPDATE SET
        summary = excluded.summary,
        source_a_text = excluded.source_a_text,
        source_b_text = excluded.source_b_text,
        created_at = excluded.created_at
    `);
    this.stmtListContradictions = this.db.prepare(
      "SELECT * FROM contradictions ORDER BY created_at DESC LIMIT ?",
    );
    this.stmtPairExists = this.db.prepare(
      "SELECT 1 FROM contradictions WHERE (source_a_id = ? AND source_b_id = ?) OR (source_a_id = ? AND source_b_id = ?) LIMIT 1",
    );

    this.stmtRecordUrl = this.db.prepare(`
      INSERT INTO ingested_urls (url, slug, summary, file_path, fetched_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        slug = excluded.slug,
        summary = excluded.summary,
        file_path = excluded.file_path,
        fetched_at = excluded.fetched_at
    `);
    this.stmtGetUrl = this.db.prepare("SELECT * FROM ingested_urls WHERE url = ?");
    this.stmtListUrls = this.db.prepare(
      "SELECT * FROM ingested_urls ORDER BY fetched_at DESC LIMIT ?",
    );

    this.stmtRecordPdf = this.db.prepare(`
      INSERT INTO ingested_pdfs (rel_path, structured_content, file_path, ingested_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(rel_path) DO UPDATE SET
        structured_content = excluded.structured_content,
        file_path = excluded.file_path,
        ingested_at = excluded.ingested_at
    `);
    this.stmtGetPdf = this.db.prepare("SELECT * FROM ingested_pdfs WHERE rel_path = ?");
    this.stmtListPdfs = this.db.prepare(
      "SELECT * FROM ingested_pdfs ORDER BY ingested_at DESC LIMIT ?",
    );

    this.stmtGetMeta = this.db.prepare("SELECT value FROM ws_meta WHERE key = ?");
    this.stmtSetMeta = this.db.prepare(`
      INSERT INTO ws_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
  }

  // ── workspace files ──────────────────────────────────────────────────────

  upsertWorkspaceFile(row: Omit<WorkspaceFileRow, "indexedAt">): void {
    const indexedAt = Date.now();
    this.stmtUpsertFile.run(
      row.relPath,
      row.content,
      row.mtime,
      row.size,
      row.contentHash,
      row.firstLine,
      row.wordCount,
      indexedAt,
    );
  }

  getWorkspaceFile(relPath: string): WorkspaceFileRow | null {
    const r = this.stmtGetFile.get(relPath) as WsFileRecord | null;
    return r ? toWorkspaceFileRow(r) : null;
  }

  listWorkspaceFiles(): WorkspaceFileRow[] {
    const rows = this.stmtListFiles.all() as WsFileRecord[];
    return rows.map(toWorkspaceFileRow);
  }

  /**
   * Lightweight projection — omits content + content_hash + mtime + size.
   * Use when you only need labels for UI / graph rendering.
   */
  listWorkspaceFileSummaries(limit: number, offset: number = 0): WorkspaceFileSummary[] {
    const rows = this.stmtListFileSummaries.all(limit, offset) as Array<{
      rel_path: string;
      first_line: string | null;
      word_count: number | null;
    }>;
    return rows.map((r) => ({
      relPath: r.rel_path,
      firstLine: r.first_line,
      wordCount: r.word_count,
    }));
  }

  countWorkspaceFiles(): number {
    const r = this.stmtCountFiles.get() as { c: number } | null;
    return r?.c ?? 0;
  }

  deleteWorkspaceFile(relPath: string): void {
    this.stmtDeleteFile.run(relPath);
  }

  searchWorkspaceFiles(query: string, limit: number = 8): WorkspaceSearchHit[] {
    const fts = buildFtsQuery(query);
    if (!fts) return [];
    try {
      const rows = this.stmtSearchFiles.all(fts, limit) as Array<{
        rel_path: string;
        first_line: string | null;
        word_count: number | null;
        excerpt: string;
      }>;
      return rows.map((r) => ({
        relPath: r.rel_path,
        firstLine: r.first_line,
        wordCount: r.word_count,
        excerpt: r.excerpt,
      }));
    } catch {
      return [];
    }
  }

  // ── file links ───────────────────────────────────────────────────────────

  replaceFileLinks(sourcePath: string, links: Omit<FileLinkRow, "sourcePath">[]): void {
    const tx = this.db.transaction((items: Omit<FileLinkRow, "sourcePath">[]) => {
      this.stmtDeleteLinks.run(sourcePath);
      for (const link of items) {
        this.stmtInsertLink.run(sourcePath, link.targetPath, link.linkType, link.raw);
      }
    });
    tx(links);
  }

  getOutboundLinks(sourcePath: string): FileLinkRow[] {
    const rows = this.stmtGetOutboundLinks.all(sourcePath) as WsLinkRecord[];
    return rows.map(toFileLinkRow);
  }

  getAllLinks(): FileLinkRow[] {
    const rows = this.stmtGetAllLinks.all() as WsLinkRecord[];
    return rows.map(toFileLinkRow);
  }

  // ── contradictions ───────────────────────────────────────────────────────

  recordContradiction(row: Omit<ContradictionRow, "id" | "createdAt"> & { id?: string }): string {
    const id = row.id ?? randomUUID();
    const createdAt = Date.now();
    this.stmtRecordContradiction.run(
      id,
      row.summary,
      row.sourceAId,
      row.sourceBId,
      row.sourceAText,
      row.sourceBText,
      createdAt,
    );
    return id;
  }

  listContradictions(limit: number = 50): ContradictionRow[] {
    const rows = this.stmtListContradictions.all(limit) as ContradictionRecord[];
    return rows.map(toContradictionRow);
  }

  contradictionPairExists(idA: string, idB: string): boolean {
    return this.stmtPairExists.get(idA, idB, idB, idA) !== null;
  }

  // ── ingested urls/pdfs ───────────────────────────────────────────────────

  recordIngestedUrl(row: Omit<IngestedUrlRow, "fetchedAt">): void {
    const fetchedAt = Date.now();
    this.stmtRecordUrl.run(row.url, row.slug, row.summary, row.filePath, fetchedAt);
  }

  getIngestedUrl(url: string): IngestedUrlRow | null {
    const r = this.stmtGetUrl.get(url) as IngestedUrlRecord | null;
    return r ? toIngestedUrlRow(r) : null;
  }

  listIngestedUrls(limit: number = 50): IngestedUrlRow[] {
    const rows = this.stmtListUrls.all(limit) as IngestedUrlRecord[];
    return rows.map(toIngestedUrlRow);
  }

  recordIngestedPdf(row: Omit<IngestedPdfRow, "ingestedAt">): void {
    const ingestedAt = Date.now();
    this.stmtRecordPdf.run(row.relPath, row.structuredContent, row.filePath, ingestedAt);
  }

  getIngestedPdf(relPath: string): IngestedPdfRow | null {
    const r = this.stmtGetPdf.get(relPath) as IngestedPdfRecord | null;
    return r ? toIngestedPdfRow(r) : null;
  }

  listIngestedPdfs(limit: number = 50): IngestedPdfRow[] {
    const rows = this.stmtListPdfs.all(limit) as IngestedPdfRecord[];
    return rows.map(toIngestedPdfRow);
  }

  // ── meta ─────────────────────────────────────────────────────────────────

  getMeta(key: string): string | null {
    const r = this.stmtGetMeta.get(key) as { value: string } | null;
    return r?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.stmtSetMeta.run(key, value);
  }

  close(): void {
    this.db.close();
  }
}

function toWorkspaceFileRow(r: WsFileRecord): WorkspaceFileRow {
  return {
    relPath: r.rel_path,
    content: r.content,
    mtime: r.mtime,
    size: r.size,
    contentHash: r.content_hash,
    firstLine: r.first_line,
    wordCount: r.word_count,
    indexedAt: r.indexed_at,
  };
}

function toFileLinkRow(r: WsLinkRecord): FileLinkRow {
  return {
    sourcePath: r.source_path,
    targetPath: r.target_path,
    linkType: r.link_type as "wikilink" | "markdown",
    raw: r.raw ?? "",
  };
}

function toContradictionRow(r: ContradictionRecord): ContradictionRow {
  return {
    id: r.id,
    summary: r.summary,
    sourceAId: r.source_a_id,
    sourceBId: r.source_b_id,
    sourceAText: r.source_a_text,
    sourceBText: r.source_b_text,
    createdAt: r.created_at,
  };
}

function toIngestedUrlRow(r: IngestedUrlRecord): IngestedUrlRow {
  return {
    url: r.url,
    slug: r.slug,
    summary: r.summary,
    filePath: r.file_path,
    fetchedAt: r.fetched_at,
  };
}

function toIngestedPdfRow(r: IngestedPdfRecord): IngestedPdfRow {
  return {
    relPath: r.rel_path,
    structuredContent: r.structured_content,
    filePath: r.file_path,
    ingestedAt: r.ingested_at,
  };
}

function buildFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(" ");
}
