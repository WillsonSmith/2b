import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { logger } from "../logger.ts";

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

  /** Add a memory with an optional type. Returns the new memory's ID. */
  public async addMemory(text: string, type: string = "factual"): Promise<string> {
    logger.debug("CortexDB", `addMemory type=${type}: getting embedding for "${text.slice(0, 80)}"`);
    const embedding = await this.llm.getEmbedding(text);
    logger.debug("CortexDB", `addMemory: embedding received (dim=${embedding.length}), inserting into DB`);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO memories (id, text, embedding, timestamp, type) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, text, JSON.stringify(embedding), Date.now(), type);
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
  }

  /** Update the text of an existing memory. */
  public async updateMemoryText(id: string, newText: string): Promise<void> {
    const embedding = await this.llm.getEmbedding(newText);
    this.db
      .prepare("UPDATE memories SET text = ?, embedding = ? WHERE id = ?")
      .run(newText, JSON.stringify(embedding), id);
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
