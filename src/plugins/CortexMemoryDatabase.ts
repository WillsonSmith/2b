import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { join } from "node:path";
import { logger } from "../logger.ts";
import { appDataPath } from "../paths.ts";

export interface MemoryFilter {
  types?: string[];
  tags?: string[];
  after?: string | number;   // ISO date string or ms timestamp
  before?: string | number;
  contains?: string;         // FTS5 full-text search
  limit?: number;
  status?: string[];         // default: ['active'] — pass ['superseded'] to see superseded memories
  scope?: string;            // namespace filter
}

export interface SearchMeta {
  total_candidates: number;
  retrieval_method: "semantic" | "fulltext" | "hybrid";
  filter_applied: string[];
}

export interface SearchResultWithMeta {
  results: Array<{ id: string; text: string; score: number; confidence_score: number }>;
  meta: SearchMeta;
}

/**
 * Reconstruct a Float32Array from a Buffer returned by bun:sqlite BLOB reads.
 * bun:sqlite returns BLOBs as Buffer (Uint8Array). We must reinterpret the raw
 * bytes as IEEE 754 float32 values — NOT copy them as integer values.
 */
function bufferToFloat32Array(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

/** Standalone SQLite memory store with type support and memory linking. */
export class CortexMemoryDatabase {
  private db: Database;
  private llm: any;

  constructor(llmProvider: any, name: string, dbPath?: string) {
    this.llm = llmProvider;
    this.db = new Database(dbPath ?? join(appDataPath("data"), `${name}.cortex.sqlite`), { create: true });
    this.initSchema();
  }

  private initSchema() {
    // Core tables — new schema uses embedding_bin BLOB (no embedding TEXT column)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        embedding_bin BLOB,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'factual'
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS memory_links (
        memory_id TEXT NOT NULL,
        linked_id TEXT NOT NULL,
        PRIMARY KEY (memory_id, linked_id)
      )
    `);

    // Schema version tracking
    this.db.run(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    this.db.run(`INSERT INTO schema_version SELECT 1, ${Date.now()} WHERE NOT EXISTS (SELECT 1 FROM schema_version)`);

    // Column migrations — each is idempotent via PRAGMA check
    const columns = this.db.prepare("PRAGMA table_info(memories)").all() as { name: string }[];

    const hasType = columns.some(c => c.name === "type");
    if (!hasType) this.db.run(`ALTER TABLE memories ADD COLUMN type TEXT NOT NULL DEFAULT 'factual'`);

    const hasTags = columns.some(c => c.name === "tags");
    if (!hasTags) this.db.run(`ALTER TABLE memories ADD COLUMN tags TEXT DEFAULT '[]'`);

    // Phase 1 columns
    const hasStatus = columns.some(c => c.name === "status");
    if (!hasStatus) this.db.run(`ALTER TABLE memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);

    const hasSource = columns.some(c => c.name === "source");
    if (!hasSource) this.db.run(`ALTER TABLE memories ADD COLUMN source TEXT`);

    const hasConfidence = columns.some(c => c.name === "confidence");
    if (!hasConfidence) this.db.run(`ALTER TABLE memories ADD COLUMN confidence REAL NOT NULL DEFAULT 1.0`);

    const hasScope = columns.some(c => c.name === "scope");
    if (!hasScope) this.db.run(`ALTER TABLE memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'global'`);

    // Phase 4 column
    const hasEmbeddingBin = columns.some(c => c.name === "embedding_bin");
    if (!hasEmbeddingBin) this.db.run(`ALTER TABLE memories ADD COLUMN embedding_bin BLOB`);

    // FTS5 virtual table for full-text search
    const ftsBefore = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
      .get();
    this.db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, text)`);
    if (!ftsBefore) {
      this.db.run(`INSERT INTO memories_fts(memory_id, text) SELECT id, text FROM memories`);
    }

    // Phase 4 migration: JSON text embeddings → Float32Array BLOB
    const version = this.getSchemaVersion();
    if (version < 2) {
      const freshCols = this.db.prepare("PRAGMA table_info(memories)").all() as { name: string }[];
      const hasOldEmbedding = freshCols.some(c => c.name === "embedding");
      if (hasOldEmbedding) {
        const rows = this.db
          .prepare("SELECT id, embedding FROM memories WHERE embedding_bin IS NULL AND embedding IS NOT NULL")
          .all() as { id: string; embedding: string }[];
        logger.info("CortexDB", `Phase 4 migration: converting ${rows.length} embeddings to binary format...`);
        const updateStmt = this.db.prepare("UPDATE memories SET embedding_bin = ? WHERE id = ?");
        const migrate = this.db.transaction(() => {
          for (const row of rows) {
            const parsed = JSON.parse(row.embedding) as number[];
            updateStmt.run(new Float32Array(parsed), row.id);
          }
          this.db.run(`UPDATE schema_version SET version = 2, updated_at = ${Date.now()}`);
        });
        migrate();
        logger.info("CortexDB", `Phase 4 migration: converted ${rows.length} embeddings.`);
        try {
          this.db.run(`ALTER TABLE memories DROP COLUMN embedding`);
        } catch (e) {
          logger.warn("CortexDB", "Could not drop old embedding column (requires SQLite 3.35+):", e);
        }
      } else {
        // Fresh database — no legacy embedding column to migrate, just bump version
        this.db.run(`UPDATE schema_version SET version = 2, updated_at = ${Date.now()}`);
      }
    }

    // Phase 3 migration: strip [THOUGHT] prefix from thought memory text — idempotent
    const migrated = this.migrateThoughtTextPrefixes();
    if (migrated > 0) {
      logger.info("CortexDB", `Thought text migration: stripped prefix from ${migrated} memories`);
    }
  }

  private getSchemaVersion(): number {
    const row = this.db.prepare("SELECT version FROM schema_version").get() as { version: number } | null;
    return row?.version ?? 1;
  }

  // ~1500 tokens per chunk with ~200-token overlap — safe under the 2048-token embedding limit
  private static readonly CHUNK_SIZE_CHARS = 6000;
  private static readonly CHUNK_OVERLAP_CHARS = 800;

  /**
   * Embed text that may exceed the model's context window.
   * Splits into overlapping chunks, embeds each, and returns the averaged vector.
   */
  private async chunkAndEmbed(text: string): Promise<number[]> {
    const { CHUNK_SIZE_CHARS, CHUNK_OVERLAP_CHARS } = CortexMemoryDatabase;
    if (text.length <= CHUNK_SIZE_CHARS) {
      return this.llm.getEmbedding(text);
    }

    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + CHUNK_SIZE_CHARS));
      start += CHUNK_SIZE_CHARS - CHUNK_OVERLAP_CHARS;
    }

    const embeddings = await Promise.all(chunks.map(chunk => this.llm.getEmbedding(chunk)));
    const dim = embeddings[0].length;
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const avg = new Array<number>(dim).fill(0);
    for (let c = 0; c < chunks.length; c++) {
      const weight = chunks[c].length / totalLen;
      for (let i = 0; i < dim; i++) avg[i] += embeddings[c][i]! * weight;
    }
    return avg;
  }

  /** Cosine similarity between two vectors. Accepts number[] or Float32Array. */
  public cosSim(a: number[] | Float32Array, b: number[] | Float32Array): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0);
      normA += (a[i] ?? 0) ** 2;
      normB += (b[i] ?? 0) ** 2;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private toMs(value: string | number): number {
    if (typeof value === "number") return value;
    return new Date(value).getTime();
  }

  /**
   * Build a WHERE clause for the given filter.
   * Defaults status to ['active'] unless the caller explicitly passes filter.status.
   * Callers must use `FROM memories m` (or join using `m` alias).
   */
  private buildWhereClause(filter: MemoryFilter): { clause: string; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];

    // Default to active-only unless caller explicitly specifies status
    const effectiveStatus = filter.status ?? ["active"];
    if (effectiveStatus.length > 0) {
      const placeholders = effectiveStatus.map(() => "?").join(", ");
      conditions.push(`m.status IN (${placeholders})`);
      params.push(...effectiveStatus);
    }

    if (filter.types && filter.types.length > 0) {
      const placeholders = filter.types.map(() => "?").join(", ");
      conditions.push(`m.type IN (${placeholders})`);
      params.push(...filter.types);
    }

    if (filter.tags && filter.tags.length > 0) {
      for (const tag of filter.tags) {
        conditions.push(`EXISTS (SELECT 1 FROM json_each(m.tags) WHERE value = ?)`);
        params.push(tag);
      }
    }

    if (filter.after !== undefined) {
      conditions.push(`m.timestamp > ?`);
      params.push(this.toMs(filter.after));
    }

    if (filter.before !== undefined) {
      conditions.push(`m.timestamp < ?`);
      params.push(this.toMs(filter.before));
    }

    if (filter.scope !== undefined) {
      conditions.push(`m.scope = ?`);
      params.push(filter.scope);
    }

    const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return { clause, params };
  }

  /** Add a memory with an optional type, tags, source, and confidence. Returns the new memory's ID. */
  public async addMemory(
    text: string,
    type: string = "factual",
    tags: string[] = [],
    source?: string,
    confidence?: number,
  ): Promise<string> {
    logger.debug("CortexDB", `addMemory type=${type}: getting embedding for "${text.slice(0, 80)}"`);
    const embedding = await this.chunkAndEmbed(text);
    // Pass Float32Array directly — Bun:sqlite accepts TypedArrays as BLOB, not plain ArrayBuffer
    const embeddingBin = new Float32Array(embedding);
    logger.debug("CortexDB", `addMemory: embedding received (dim=${embedding.length}), inserting into DB`);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO memories (id, text, embedding_bin, timestamp, type, tags, status, source, confidence, scope) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 'global')",
      )
      .run(id, text, embeddingBin, Date.now(), type, JSON.stringify(tags), source ?? null, confidence ?? 1.0);
    this.db.prepare("INSERT INTO memories_fts(memory_id, text) VALUES (?, ?)").run(id, text);
    logger.debug("CortexDB", `addMemory: inserted id=${id.slice(0, 8)}`);
    return id;
  }

  /** Compute and return an embedding vector for the given text. */
  public async getEmbedding(text: string): Promise<number[]> {
    return this.llm.getEmbedding(text);
  }

  /** Search memories by embedding similarity. Optionally filter by type or array of types. */
  public async search(
    query: string,
    limit: number = 5,
    threshold: number = 0.5,
    type?: string | string[],
  ): Promise<Array<{ id: string; text: string; score: number }>> {
    logger.debug(
      "CortexDB",
      `search limit=${limit} threshold=${threshold}${type ? ` type=${Array.isArray(type) ? type.join(",") : type}` : ""}: "${query.slice(0, 80)}"`,
    );
    const queryEmbedding = await this.llm.getEmbedding(query);
    return this.searchWithEmbedding(queryEmbedding, limit, threshold, type);
  }

  /**
   * Search memories using a pre-computed embedding.
   * When includeEmbeddings is true, each result includes the stored Float32Array embedding
   * (used by CortexMemoryPlugin for MMR diversity selection).
   */
  public searchWithEmbedding(
    queryEmbedding: number[],
    limit: number,
    threshold: number,
    type: string | string[] | undefined,
    includeEmbeddings: true,
  ): Array<{ id: string; text: string; score: number; embedding: Float32Array }>;
  public searchWithEmbedding(
    queryEmbedding: number[],
    limit?: number,
    threshold?: number,
    type?: string | string[],
    includeEmbeddings?: false | undefined,
  ): Array<{ id: string; text: string; score: number }>;
  public searchWithEmbedding(
    queryEmbedding: number[],
    limit: number = 5,
    threshold: number = 0.5,
    type?: string | string[],
    includeEmbeddings?: boolean,
  ): Array<{ id: string; text: string; score: number; embedding?: Float32Array }> {
    let rows: { id: string; text: string; embedding_bin: Buffer }[];
    if (Array.isArray(type)) {
      const placeholders = type.map(() => "?").join(", ");
      rows = this.db
        .prepare(`SELECT id, text, embedding_bin FROM memories WHERE type IN (${placeholders}) AND status = 'active'`)
        .all(...type) as { id: string; text: string; embedding_bin: Buffer }[];
    } else {
      rows = (
        type
          ? this.db
              .prepare("SELECT id, text, embedding_bin FROM memories WHERE type = ? AND status = 'active'")
              .all(type)
          : this.db.prepare("SELECT id, text, embedding_bin FROM memories WHERE status = 'active'").all()
      ) as { id: string; text: string; embedding_bin: Buffer }[];
    }

    const results = rows
      .filter(row => row.embedding_bin != null)
      .map(row => {
        // embedding_bin is returned as a Buffer (Uint8Array) by bun:sqlite.
        // Use the ArrayBuffer view constructor to reinterpret raw bytes as float32 values.
        const emb = bufferToFloat32Array(row.embedding_bin);
        const score = this.cosSim(queryEmbedding, emb);
        if (includeEmbeddings) {
          return { id: row.id, text: row.text, score, embedding: emb };
        }
        return { id: row.id, text: row.text, score };
      })
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results as Array<{ id: string; text: string; score: number; embedding?: Float32Array }>;
  }

  /** Search memories by embedding similarity and return results with retrieval metadata. */
  public async searchWithStats(
    query: string,
    limit: number = 5,
    threshold: number = 0.5,
    type?: string | string[],
  ): Promise<SearchResultWithMeta> {
    const queryEmbedding = await this.llm.getEmbedding(query);

    let totalCandidates: number;
    if (Array.isArray(type)) {
      const placeholders = type.map(() => "?").join(", ");
      totalCandidates = (
        this.db
          .prepare(`SELECT COUNT(*) as count FROM memories WHERE type IN (${placeholders}) AND status = 'active'`)
          .get(...type) as { count: number }
      ).count;
    } else if (type) {
      totalCandidates = (
        this.db
          .prepare(`SELECT COUNT(*) as count FROM memories WHERE type = ? AND status = 'active'`)
          .get(type) as { count: number }
      ).count;
    } else {
      totalCandidates = (
        this.db.prepare(`SELECT COUNT(*) as count FROM memories WHERE status = 'active'`).get() as { count: number }
      ).count;
    }

    const results = this.searchWithEmbedding(queryEmbedding, limit, threshold, type);
    const filterApplied = type
      ? Array.isArray(type)
        ? type.map(t => `type=${t}`)
        : [`type=${type}`]
      : [];

    return {
      results: results.map(r => ({ ...r, confidence_score: r.score })),
      meta: { total_candidates: totalCandidates, retrieval_method: "semantic", filter_applied: filterApplied },
    };
  }

  /** Filter memories by metadata. Returns results ordered by recency. */
  public queryMemories(
    filter: MemoryFilter,
  ): Array<{ id: string; text: string; timestamp: number; type: string; tags: string[] }> {
    const limit = filter.limit ?? 20;
    const { clause, params } = this.buildWhereClause(filter);

    let whereClause = clause;
    const allParams: any[] = [...params];

    if (filter.contains) {
      const ftsCondition = `m.id IN (SELECT memory_id FROM memories_fts WHERE memories_fts MATCH ?)`;
      whereClause = whereClause
        ? `${whereClause} AND ${ftsCondition}`
        : `WHERE ${ftsCondition}`;
      allParams.push(filter.contains);
    }

    const sql = `SELECT m.id, m.text, m.timestamp, m.type, m.tags FROM memories m ${whereClause} ORDER BY m.timestamp DESC LIMIT ?`;
    allParams.push(limit);

    const rows = this.db.prepare(sql).all(...allParams) as {
      id: string;
      text: string;
      timestamp: number;
      type: string;
      tags: string;
    }[];

    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags ?? "[]") as string[],
    }));
  }

  /** Get counts grouped by type, tag, or date. */
  public aggregateMemories(
    groupBy: "type" | "tag" | "date",
    filter?: MemoryFilter,
  ): Array<{ group: string; count: number }> {
    const effectiveFilter = filter ?? {};

    if (groupBy === "type") {
      const { clause, params } = this.buildWhereClause(effectiveFilter);
      const sql = `SELECT m.type as group_key, COUNT(*) as count FROM memories m ${clause} GROUP BY m.type ORDER BY count DESC`;
      const rows = this.db.prepare(sql).all(...params) as { group_key: string; count: number }[];
      return rows.map(r => ({ group: r.group_key, count: r.count }));
    }

    if (groupBy === "tag") {
      const { clause, params } = this.buildWhereClause(effectiveFilter);
      let whereClause: string;
      if (clause) {
        const conditions = clause.slice("WHERE ".length);
        whereClause = `WHERE je.value != '' AND ${conditions}`;
      } else {
        whereClause = `WHERE je.value != ''`;
      }
      const sql = `SELECT je.value as group_key, COUNT(*) as count FROM memories m, json_each(m.tags) je ${whereClause} GROUP BY je.value ORDER BY count DESC`;
      const rows = this.db.prepare(sql).all(...params) as { group_key: string; count: number }[];
      return rows.map(r => ({ group: r.group_key, count: r.count }));
    }

    // groupBy === "date"
    const { clause, params } = this.buildWhereClause(effectiveFilter);
    const sql = `SELECT date(m.timestamp/1000, 'unixepoch') as group_key, COUNT(*) as count FROM memories m ${clause} GROUP BY group_key ORDER BY group_key DESC`;
    const rows = this.db.prepare(sql).all(...params) as { group_key: string; count: number }[];
    return rows.map(r => ({ group: r.group_key, count: r.count }));
  }

  /** Retrieve memories in chronological order within an optional timestamp range. */
  public getMemoryTimeline(
    start?: number,
    end?: number,
    limit: number = 20,
  ): Array<{ id: string; text: string; timestamp: number; type: string; tags: string[] }> {
    const conditions: string[] = ["status = 'active'"];
    const params: any[] = [];

    if (start !== undefined) {
      conditions.push("timestamp > ?");
      params.push(start);
    }
    if (end !== undefined) {
      conditions.push("timestamp < ?");
      params.push(end);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;
    const sql = `SELECT id, text, timestamp, type, tags FROM memories ${whereClause} ORDER BY timestamp ASC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as {
      id: string;
      text: string;
      timestamp: number;
      type: string;
      tags: string;
    }[];

    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags ?? "[]") as string[],
    }));
  }

  /**
   * Combine semantic similarity search with metadata filters.
   * When filter.contains is set, fuses BM25 lexical scores with vector scores
   * using reciprocal rank fusion (alpha=0.7 semantic / 0.3 lexical).
   */
  public async hybridSearch(
    query: string,
    filter?: MemoryFilter,
    limit: number = 5,
    threshold: number = 0.4,
  ): Promise<
    Array<{ id: string; text: string; score: number; timestamp: number; type: string; tags: string[] }>
  > {
    const queryEmbedding = await this.llm.getEmbedding(query);
    const { clause, params } = this.buildWhereClause(filter ?? {});
    let whereClause = clause;
    const allParams: any[] = [...params];

    // Build BM25 score map for fusion when a text filter is requested
    let bm25Map: Map<string, number> | null = null;
    if (filter?.contains) {
      const ftsCondition = `m.id IN (SELECT memory_id FROM memories_fts WHERE memories_fts MATCH ?)`;
      whereClause = whereClause
        ? `${whereClause} AND ${ftsCondition}`
        : `WHERE ${ftsCondition}`;
      allParams.push(filter.contains);

      const bm25Rows = this.db
        .prepare(
          `SELECT memory_id, bm25(memories_fts) as bm25_score FROM memories_fts WHERE memories_fts MATCH ?`,
        )
        .all(filter.contains) as { memory_id: string; bm25_score: number }[];
      if (bm25Rows.length > 0) {
        bm25Map = new Map(bm25Rows.map(r => [r.memory_id, r.bm25_score]));
      }
    }

    // Compute minimum BM25 score for normalization (BM25 returns negatives; more negative = more relevant)
    let minBm25 = -1;
    if (bm25Map && bm25Map.size > 0) {
      const values = Array.from(bm25Map.values());
      const computed = Math.min(...values);
      if (computed !== 0) minBm25 = computed;
    }

    const sql = `SELECT m.id, m.text, m.embedding_bin, m.timestamp, m.type, m.tags FROM memories m ${whereClause}`;
    const rows = this.db.prepare(sql).all(...allParams) as {
      id: string;
      text: string;
      embedding_bin: Buffer;
      timestamp: number;
      type: string;
      tags: string;
    }[];

    const results = rows
      .filter(row => row.embedding_bin != null)
      .map(row => {
        const vectorScore = this.cosSim(queryEmbedding, bufferToFloat32Array(row.embedding_bin));
        let finalScore = vectorScore;

        if (bm25Map) {
          const bm25Raw = bm25Map.get(row.id) ?? 0;
          const normalizedBm25 = bm25Raw === 0 ? 0 : bm25Raw / minBm25;
          finalScore = 0.7 * vectorScore + 0.3 * normalizedBm25;
        }

        return {
          id: row.id,
          text: row.text,
          score: finalScore,
          timestamp: row.timestamp,
          type: row.type,
          tags: JSON.parse(row.tags ?? "[]") as string[],
        };
      })
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return results;
  }

  /** Fetch stored embeddings for a batch of memory IDs. Returns a Map from id → Float32Array. */
  public getEmbeddingsByIds(ids: string[]): Map<string, Float32Array> {
    if (ids.length === 0) return new Map();
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT id, embedding_bin FROM memories WHERE id IN (${placeholders})`)
      .all(...ids) as { id: string; embedding_bin: Buffer }[];
    const result = new Map<string, Float32Array>();
    for (const row of rows) {
      if (row.embedding_bin) result.set(row.id, bufferToFloat32Array(row.embedding_bin));
    }
    return result;
  }

  /** Create a bidirectional link between two memories. */
  public async linkMemories(idA: string, idB: string): Promise<void> {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO memory_links (memory_id, linked_id) VALUES (?, ?)",
    );
    stmt.run(idA, idB);
    stmt.run(idB, idA);
  }

  /** Return all active memories linked to the given ID. */
  public async getLinkedMemories(
    id: string,
  ): Promise<Array<{ id: string; text: string }>> {
    return this.db
      .prepare(
        `SELECT m.id, m.text FROM memories m
         INNER JOIN memory_links l ON m.id = l.linked_id
         WHERE l.memory_id = ? AND m.status = 'active'`,
      )
      .all(id) as { id: string; text: string }[];
  }

  /** Delete a memory and all its links. */
  public async deleteMemory(id: string): Promise<void> {
    this.db
      .prepare("DELETE FROM memory_links WHERE memory_id = ? OR linked_id = ?")
      .run(id, id);
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM memories_fts WHERE memory_id = ?").run(id);
  }

  /** Update the text of an existing memory and re-embed. */
  public async updateMemoryText(id: string, newText: string): Promise<void> {
    const embedding = await this.chunkAndEmbed(newText);
    const embeddingBin = new Float32Array(embedding);
    this.db
      .prepare("UPDATE memories SET text = ?, embedding_bin = ? WHERE id = ?")
      .run(newText, embeddingBin, id);
    this.db.prepare("UPDATE memories_fts SET text = ? WHERE memory_id = ?").run(newText, id);
  }

  /** Update the status of a memory (e.g. 'active' → 'superseded'). */
  public async updateMemoryStatus(id: string, status: string): Promise<void> {
    this.db.prepare("UPDATE memories SET status = ? WHERE id = ?").run(status, id);
  }

  /** Retrieve a memory by ID, including its tags. */
  public async getMemoryById(
    id: string,
  ): Promise<{ id: string; text: string; timestamp: number; type: string; tags: string[] } | null> {
    const row = this.db
      .prepare("SELECT id, text, timestamp, type, tags FROM memories WHERE id = ?")
      .get(id) as { id: string; text: string; timestamp: number; type: string; tags: string } | null;
    if (!row) return null;
    return {
      ...row,
      tags: JSON.parse(row.tags ?? "[]") as string[],
    };
  }

  /** Get the N most recent active memories, optionally filtered by type. */
  public getRecentMemories(
    limit: number = 3,
    type?: string,
  ): Array<{ id: string; text: string; timestamp: number }> {
    if (type) {
      return this.db
        .prepare(
          "SELECT id, text, timestamp FROM memories WHERE type = ? AND status = 'active' ORDER BY timestamp DESC LIMIT ?",
        )
        .all(type, limit) as { id: string; text: string; timestamp: number }[];
    }
    return this.db
      .prepare(
        "SELECT id, text, timestamp FROM memories WHERE status = 'active' ORDER BY timestamp DESC LIMIT ?",
      )
      .all(limit) as { id: string; text: string; timestamp: number }[];
  }

  /**
   * Strip the legacy [THOUGHT] ISO-timestamp prefix from thought memory text.
   * Idempotent — rows that don't match the prefix are untouched.
   * Does NOT re-embed (embedding drift from a short prefix is negligible).
   * Returns the count of rows updated.
   */
  public migrateThoughtTextPrefixes(): number {
    const rows = this.db
      .prepare("SELECT id, text FROM memories WHERE type = 'thought'")
      .all() as { id: string; text: string }[];

    const prefixRe = /^\[THOUGHT\] \d{4}-\d{2}-\d{2}T[\d:.]+Z: /;
    let count = 0;
    for (const row of rows) {
      if (!prefixRe.test(row.text)) continue;
      const stripped = row.text.replace(prefixRe, "");
      this.db.prepare("UPDATE memories SET text = ? WHERE id = ?").run(stripped, row.id);
      this.db.prepare("UPDATE memories_fts SET text = ? WHERE memory_id = ?").run(stripped, row.id);
      count++;
    }
    return count;
  }
}
