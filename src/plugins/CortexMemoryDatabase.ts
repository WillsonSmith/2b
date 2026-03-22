import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { logger } from "../logger.ts";

export interface MemoryFilter {
  types?: string[];
  tags?: string[];
  after?: string | number;   // ISO date string or ms timestamp
  before?: string | number;
  contains?: string;         // FTS5 full-text search
  limit?: number;
}

/** Standalone SQLite memory store with type support and memory linking. */
export class CortexMemoryDatabase {
  private db: Database;
  private llm: any;

  constructor(llmProvider: any, name: string, dbPath?: string) {
    this.llm = llmProvider;
    this.db = new Database(dbPath ?? `./data/${name}.cortex.sqlite`, { create: true });
    this.initSchema();
  }

  private initSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
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

    // Migration: add type column if missing (for existing databases)
    const columns = this.db.prepare("PRAGMA table_info(memories)").all() as {
      name: string;
    }[];
    const hasType = columns.some((c) => c.name === "type");
    if (!hasType) {
      this.db.run(`ALTER TABLE memories ADD COLUMN type TEXT NOT NULL DEFAULT 'factual'`);
    }

    // Migration: add tags column if missing
    const hasTags = columns.some((c) => c.name === "tags");
    if (!hasTags) {
      this.db.run(`ALTER TABLE memories ADD COLUMN tags TEXT DEFAULT '[]'`);
    }

    // Create FTS5 virtual table for full-text search
    const ftsBefore = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'")
      .get();
    this.db.run(
      `CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, text)`,
    );
    // If FTS table was just created, populate from existing memories
    if (!ftsBefore) {
      this.db.run(`INSERT INTO memories_fts(memory_id, text) SELECT id, text FROM memories`);
    }
  }

  private cosSim(a: number[], b: number[]): number {
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
   * Build a WHERE clause for the given filter (excluding `contains` — handle FTS separately).
   * Callers must use `FROM memories m` (or join using `m` alias).
   */
  private buildWhereClause(filter: MemoryFilter): { clause: string; params: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];

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

    const clause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return { clause, params };
  }

  /** Add a memory with an optional type and tags. Returns the new memory's ID. */
  public async addMemory(
    text: string,
    type: string = "factual",
    tags: string[] = [],
  ): Promise<string> {
    logger.debug("CortexDB", `addMemory type=${type}: getting embedding for "${text.slice(0, 80)}"`);
    const embedding = await this.llm.getEmbedding(text);
    logger.debug("CortexDB", `addMemory: embedding received (dim=${embedding.length}), inserting into DB`);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO memories (id, text, embedding, timestamp, type, tags) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(id, text, JSON.stringify(embedding), Date.now(), type, JSON.stringify(tags));
    this.db
      .prepare("INSERT INTO memories_fts(memory_id, text) VALUES (?, ?)")
      .run(id, text);
    logger.debug("CortexDB", `addMemory: inserted id=${id.slice(0, 8)}`);
    return id;
  }

  /** Search memories by embedding similarity. Optionally filter by type or array of types. */
  public async search(
    query: string,
    limit: number = 5,
    threshold: number = 0.5,
    type?: string | string[],
  ): Promise<Array<{ id: string; text: string; score: number }>> {
    logger.debug("CortexDB", `search limit=${limit} threshold=${threshold}${type ? ` type=${Array.isArray(type) ? type.join(",") : type}` : ""}: "${query.slice(0, 80)}"`);
    const queryEmbedding = await this.llm.getEmbedding(query);

    let rows: { id: string; text: string; embedding: string }[];
    if (Array.isArray(type)) {
      const placeholders = type.map(() => "?").join(", ");
      rows = this.db
        .prepare(`SELECT id, text, embedding FROM memories WHERE type IN (${placeholders})`)
        .all(...type) as { id: string; text: string; embedding: string }[];
    } else {
      rows = (
        type
          ? this.db
              .prepare("SELECT id, text, embedding FROM memories WHERE type = ?")
              .all(type)
          : this.db.prepare("SELECT id, text, embedding FROM memories").all()
      ) as { id: string; text: string; embedding: string }[];
    }

    return rows
      .map((row) => ({
        id: row.id,
        text: row.text,
        score: this.cosSim(queryEmbedding, JSON.parse(row.embedding) as number[]),
      }))
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
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

    return rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags ?? "[]") as string[],
    }));
  }

  /** Get counts grouped by type, tag, or date. */
  public aggregateMemories(
    groupBy: "type" | "tag" | "date",
    filter?: MemoryFilter,
  ): Array<{ group: string; count: number }> {
    if (groupBy === "type") {
      const { clause, params } = this.buildWhereClause(filter ?? {});
      const sql = `SELECT m.type as group_key, COUNT(*) as count FROM memories m ${clause} GROUP BY m.type ORDER BY count DESC`;
      const rows = this.db.prepare(sql).all(...params) as { group_key: string; count: number }[];
      return rows.map((r) => ({ group: r.group_key, count: r.count }));
    }

    if (groupBy === "tag") {
      const { clause, params } = this.buildWhereClause(filter ?? {});
      // clause is either "" or "WHERE ..."
      // We need to insert je.value != '' as a condition
      let whereClause: string;
      if (clause) {
        // clause starts with WHERE, strip it and rebuild
        const conditions = clause.slice("WHERE ".length);
        whereClause = `WHERE je.value != '' AND ${conditions}`;
      } else {
        whereClause = `WHERE je.value != ''`;
      }
      const sql = `SELECT je.value as group_key, COUNT(*) as count FROM memories m, json_each(m.tags) je ${whereClause} GROUP BY je.value ORDER BY count DESC`;
      const rows = this.db.prepare(sql).all(...params) as { group_key: string; count: number }[];
      return rows.map((r) => ({ group: r.group_key, count: r.count }));
    }

    // groupBy === "date"
    const { clause, params } = this.buildWhereClause(filter ?? {});
    const sql = `SELECT date(m.timestamp/1000, 'unixepoch') as group_key, COUNT(*) as count FROM memories m ${clause} GROUP BY group_key ORDER BY group_key DESC`;
    const rows = this.db.prepare(sql).all(...params) as { group_key: string; count: number }[];
    return rows.map((r) => ({ group: r.group_key, count: r.count }));
  }

  /** Retrieve memories in chronological order within an optional timestamp range. */
  public getMemoryTimeline(
    start?: number,
    end?: number,
    limit: number = 20,
  ): Array<{ id: string; text: string; timestamp: number; type: string; tags: string[] }> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (start !== undefined) {
      conditions.push("timestamp > ?");
      params.push(start);
    }
    if (end !== undefined) {
      conditions.push("timestamp < ?");
      params.push(end);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT id, text, timestamp, type, tags FROM memories ${whereClause} ORDER BY timestamp ASC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as {
      id: string;
      text: string;
      timestamp: number;
      type: string;
      tags: string;
    }[];

    return rows.map((row) => ({
      ...row,
      tags: JSON.parse(row.tags ?? "[]") as string[],
    }));
  }

  /** Combine semantic similarity search with metadata filters. */
  public async hybridSearch(
    query: string,
    filter?: MemoryFilter,
    limit: number = 5,
    threshold: number = 0.4,
  ): Promise<Array<{ id: string; text: string; score: number; timestamp: number; type: string; tags: string[] }>> {
    const queryEmbedding = await this.llm.getEmbedding(query);

    const { clause, params } = this.buildWhereClause(filter ?? {});
    let whereClause = clause;
    const allParams: any[] = [...params];

    if (filter?.contains) {
      const ftsCondition = `m.id IN (SELECT memory_id FROM memories_fts WHERE memories_fts MATCH ?)`;
      whereClause = whereClause
        ? `${whereClause} AND ${ftsCondition}`
        : `WHERE ${ftsCondition}`;
      allParams.push(filter.contains);
    }

    const sql = `SELECT m.id, m.text, m.embedding, m.timestamp, m.type, m.tags FROM memories m ${whereClause}`;
    const rows = this.db.prepare(sql).all(...allParams) as {
      id: string;
      text: string;
      embedding: string;
      timestamp: number;
      type: string;
      tags: string;
    }[];

    return rows
      .map((row) => ({
        id: row.id,
        text: row.text,
        score: this.cosSim(queryEmbedding, JSON.parse(row.embedding) as number[]),
        timestamp: row.timestamp,
        type: row.type,
        tags: JSON.parse(row.tags ?? "[]") as string[],
      }))
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Create a bidirectional link between two memories. */
  public async linkMemories(idA: string, idB: string): Promise<void> {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO memory_links (memory_id, linked_id) VALUES (?, ?)",
    );
    stmt.run(idA, idB);
    stmt.run(idB, idA);
  }

  /** Return all memories linked to the given ID. */
  public async getLinkedMemories(
    id: string,
  ): Promise<Array<{ id: string; text: string }>> {
    return this.db
      .prepare(
        `SELECT m.id, m.text FROM memories m
         INNER JOIN memory_links l ON m.id = l.linked_id
         WHERE l.memory_id = ?`,
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

  /** Update the text of an existing memory. */
  public async updateMemoryText(id: string, newText: string): Promise<void> {
    const embedding = await this.llm.getEmbedding(newText);
    this.db
      .prepare("UPDATE memories SET text = ?, embedding = ? WHERE id = ?")
      .run(newText, JSON.stringify(embedding), id);
    this.db
      .prepare("UPDATE memories_fts SET text = ? WHERE memory_id = ?")
      .run(newText, id);
  }

  /** Retrieve a memory by ID. */
  public async getMemoryById(
    id: string,
  ): Promise<{ id: string; text: string; timestamp: number; type: string } | null> {
    return (
      (this.db
        .prepare("SELECT id, text, timestamp, type FROM memories WHERE id = ?")
        .get(id) as { id: string; text: string; timestamp: number; type: string } | null) ??
      null
    );
  }

  /** Get the N most recent memories, optionally filtered by type. */
  public getRecentMemories(
    limit: number = 3,
    type?: string,
  ): Array<{ id: string; text: string; timestamp: number }> {
    if (type) {
      return this.db
        .prepare(
          "SELECT id, text, timestamp FROM memories WHERE type = ? ORDER BY timestamp DESC LIMIT ?",
        )
        .all(type, limit) as { id: string; text: string; timestamp: number }[];
    }
    return this.db
      .prepare(
        "SELECT id, text, timestamp FROM memories ORDER BY timestamp DESC LIMIT ?",
      )
      .all(limit) as { id: string; text: string; timestamp: number }[];
  }
}
