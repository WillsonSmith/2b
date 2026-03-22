import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";

export class DocumentDatabase {
  private db: Database;

  constructor(dbPath: string = "documents.sqlite") {
    this.db = new Database(dbPath, { create: true });
    this.initSchema();
  }

  private initSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS documents (
        path TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        embedding TEXT,
        tags TEXT,
        created INTEGER NOT NULL,
        last_versioned INTEGER
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS document_versions (
        id TEXT PRIMARY KEY,
        document_path TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        document_path TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL
      )
    `);
  }

  private cos_sim(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0);
      normA += (a[i] ?? 0) ** 2;
      normB += (b[i] ?? 0) ** 2;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  public async upsertDocument(
    path: string,
    title: string,
    summary: string | null,
    embedding: number[] | null,
    tags: string[],
  ): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO documents (path, title, summary, embedding, tags, created)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET
           title = excluded.title,
           summary = excluded.summary,
           embedding = excluded.embedding,
           tags = excluded.tags`,
      )
      .run(
        path,
        title,
        summary ?? "",
        embedding ? JSON.stringify(embedding) : null,
        JSON.stringify(tags),
        Date.now(),
      );
  }

  public async updateEmbedding(path: string, embedding: number[]): Promise<void> {
    this.db
      .prepare("UPDATE documents SET embedding = ? WHERE path = ?")
      .run(JSON.stringify(embedding), path);
  }

  public async updateSummary(path: string, summary: string): Promise<void> {
    this.db
      .prepare("UPDATE documents SET summary = ? WHERE path = ?")
      .run(summary, path);
  }

  public async search(
    queryEmbedding: number[],
    limit: number = 5,
    threshold: number = 0.4,
  ): Promise<Array<{ path: string; title: string; summary: string; score: number }>> {
    const rows = this.db
      .prepare("SELECT path, title, summary, embedding FROM documents WHERE embedding IS NOT NULL")
      .all() as { path: string; title: string; summary: string; embedding: string }[];

    return rows
      .map((row) => ({
        path: row.path,
        title: row.title,
        summary: row.summary ?? "",
        score: this.cos_sim(queryEmbedding, JSON.parse(row.embedding)),
      }))
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  public getDocumentsByPaths(paths: string[]): Array<{ path: string; title: string }> {
    if (paths.length === 0) return [];
    const placeholders = paths.map(() => "?").join(", ");
    return this.db
      .prepare(`SELECT path, title FROM documents WHERE path IN (${placeholders})`)
      .all(...paths) as { path: string; title: string }[];
  }

  public getAllDocuments(): Array<{ path: string; title: string; summary: string | null }> {
    return this.db
      .prepare("SELECT path, title, summary FROM documents ORDER BY created DESC")
      .all() as { path: string; title: string; summary: string | null }[];
  }

  public async upsertChunks(
    documentPath: string,
    chunks: Array<{ text: string; embedding: number[] }>,
  ): Promise<void> {
    this.db.prepare("DELETE FROM document_chunks WHERE document_path = ?").run(documentPath);
    const insert = this.db.prepare(
      "INSERT INTO document_chunks (id, document_path, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < chunks.length; i++) {
      insert.run(randomUUID(), documentPath, i, chunks[i]!.text, JSON.stringify(chunks[i]!.embedding));
    }
  }

  public async searchChunks(
    queryEmbedding: number[],
    limit: number = 5,
    threshold: number = 0.4,
  ): Promise<Array<{ documentPath: string; chunkIndex: number; text: string; score: number }>> {
    const rows = this.db
      .prepare("SELECT document_path, chunk_index, text, embedding FROM document_chunks")
      .all() as { document_path: string; chunk_index: number; text: string; embedding: string }[];

    return rows
      .map((row) => ({
        documentPath: row.document_path,
        chunkIndex: row.chunk_index,
        text: row.text,
        score: this.cos_sim(queryEmbedding, JSON.parse(row.embedding) as number[]),
      }))
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  public async deleteChunks(documentPath: string): Promise<void> {
    this.db.prepare("DELETE FROM document_chunks WHERE document_path = ?").run(documentPath);
  }

  public deleteDocument(documentPath: string): void {
    this.db.prepare("DELETE FROM document_chunks WHERE document_path = ?").run(documentPath);
    this.db.prepare("DELETE FROM document_versions WHERE document_path = ?").run(documentPath);
    this.db.prepare("DELETE FROM documents WHERE path = ?").run(documentPath);
  }

  public updateTitle(documentPath: string, newTitle: string): void {
    this.db.prepare("UPDATE documents SET title = ? WHERE path = ?").run(newTitle, documentPath);
  }

  public async saveVersion(documentPath: string, content: string): Promise<string> {
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO document_versions (id, document_path, content, timestamp) VALUES (?, ?, ?, ?)",
      )
      .run(id, documentPath, content, Date.now());
    this.db
      .prepare("UPDATE documents SET last_versioned = ? WHERE path = ?")
      .run(Date.now(), documentPath);
    return id;
  }

  public async getVersions(
    documentPath: string,
  ): Promise<Array<{ id: string; timestamp: number }>> {
    return this.db
      .prepare(
        "SELECT id, timestamp FROM document_versions WHERE document_path = ? ORDER BY timestamp DESC",
      )
      .all(documentPath) as { id: string; timestamp: number }[];
  }

  public async getVersion(
    versionId: string,
  ): Promise<{ content: string; timestamp: number } | null> {
    const row = this.db
      .prepare("SELECT content, timestamp FROM document_versions WHERE id = ?")
      .get(versionId) as { content: string; timestamp: number } | null;
    return row ?? null;
  }
}
