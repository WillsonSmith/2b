import { Database } from "bun:sqlite";
import type { MemoryProvider } from "./MemoryProvider.ts";

export class SQLiteMemoryProvider implements MemoryProvider {
  private db: Database;

  constructor(dbPath: string = "./vision-ai.db") {
    this.db = new Database(dbPath);

    // Create the conversations table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,              -- 'user', 'agent', 'assistant', 'system'
        content TEXT NOT NULL,           -- The actual transcribed text
        interaction_type TEXT NOT NULL,  -- 'direct', 'overheard', 'vision', etc.
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Adds a new message to the database.
   */
  addMessage(
    role: "user" | "agent" | "assistant" | "system",
    content: string,
    interactionType: string = "direct",
  ) {
    const query = this.db.prepare(
      "INSERT INTO conversations (role, content, interaction_type, timestamp) VALUES (?1, ?2, ?3, ?4)",
    );
    query.run(role, content, interactionType, new Date().toISOString());
  }

  /**
   * Retrieves the most recent conversation context to feed into the LLM.
   */
  getRecentContext(limit: number = 10): string {
    const query = this.db.query(`
      SELECT role, content, interaction_type, timestamp 
      FROM conversations 
      ORDER BY timestamp DESC 
      LIMIT ?1
    `);

    // Cast and reverse so it reads chronologically (oldest at top, newest at bottom)
    const results = query.all(limit) as any[];
    if (results.length === 0) return "No previous conversation.";

    return results
      .reverse()
      .map((r) => {
        const typeLabel =
          r.interaction_type !== "direct" ? `[${r.interaction_type}] ` : "";
        return `${typeLabel}${r.role.toUpperCase()}: ${r.content}`;
      })
      .join("\\n");
  }

  /**
   * Retrieves the most recent conversation as an array of messages for chat APIs.
   */
  getRecentMessages(limit: number = 10): { role: string; content: string }[] {
    const query = this.db.query(`
      SELECT role, content, interaction_type, timestamp 
      FROM conversations 
      ORDER BY timestamp DESC 
      LIMIT ?1
    `);

    const results = query.all(limit) as any[];
    if (results.length === 0) return [];

    const mapped = results.reverse().map((r) => {
      // For chat API, 'agent' usually needs to be mapped to 'assistant'
      const role = r.role === "agent" ? "assistant" : r.role;
      const typeLabel =
        r.interaction_type !== "direct" ? `[${r.interaction_type}] ` : "";
      return {
        role,
        content: `${typeLabel}${r.content}`,
      };
    });

    const consolidated: { role: string; content: string }[] = [];
    for (const msg of mapped) {
      const last = consolidated[consolidated.length - 1];
      if (last && last.role === msg.role) {
        last.content += "\\n" + msg.content;
      } else {
        consolidated.push(msg);
      }
    }

    if (consolidated.length > 0 && consolidated[0]?.role === "assistant") {
      consolidated.shift();
    }

    return consolidated;
  }
}
