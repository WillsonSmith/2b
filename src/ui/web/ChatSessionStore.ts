import { Database } from "bun:sqlite";
import { join } from "node:path";
import { appDataPath } from "../../paths.ts";
import type { ChatMessage } from "../types.ts";

export interface SessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export type SessionMeta = Omit<SessionRecord, "messages">;

type SessionRow = {
  id: string;
  title: string;
  messages: string;
  created_at: number;
  updated_at: number;
};

export class ChatSessionStore {
  private db: Database;

  constructor(dbPath?: string) {
    const path = dbPath ?? join(appDataPath("data"), "sessions.sqlite");
    this.db = new Database(path, { create: true });
    this.initSchema();
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL DEFAULT 'New Chat',
        messages   TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
  }

  private rowToRecord(row: SessionRow): SessionRecord {
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messages: JSON.parse(row.messages) as ChatMessage[],
    };
  }

  listSessions(): Omit<SessionRecord, "messages">[] {
    const rows = this.db
      .query<Omit<SessionRow, "messages">, []>(
        "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
      )
      .all();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db
      .query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?")
      .get(id);
    return row ? this.rowToRecord(row) : null;
  }

  createSession(id: string): SessionRecord {
    const now = Date.now();
    this.db.run(
      "INSERT INTO sessions (id, title, messages, created_at, updated_at) VALUES (?, 'New Chat', '[]', ?, ?)",
      [id, now, now],
    );
    return { id, title: "New Chat", createdAt: now, updatedAt: now, messages: [] };
  }

  updateTitle(id: string, title: string): void {
    this.db.run(
      "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
      [title, Date.now(), id],
    );
  }

  saveMessages(id: string, messages: ChatMessage[], bumpTimestamp = true): void {
    if (bumpTimestamp) {
      this.db.run(
        "UPDATE sessions SET messages = ?, updated_at = ? WHERE id = ?",
        [JSON.stringify(messages), Date.now(), id],
      );
    } else {
      this.db.run(
        "UPDATE sessions SET messages = ? WHERE id = ?",
        [JSON.stringify(messages), id],
      );
    }
  }

  deleteSession(id: string): void {
    this.db.run("DELETE FROM sessions WHERE id = ?", [id]);
  }
}
