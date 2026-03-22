import { Database } from "bun:sqlite";
export class SightingLogger {
  private db: Database;

  constructor(dbPath: string = "./vision-ai.db") {
    this.db = new Database(dbPath);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sightings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        confidence REAL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  record(name: string, confidence: number) {
    const query = this.db.prepare(
      "INSERT INTO sightings (name, confidence, timestamp) VALUES (?1, ?2, ?3)",
    );
    query.run(name, confidence, new Date().toISOString());
  }

  getRecentHistorySummary(hours: number = 24): string {
    const query = this.db.query(`
      SELECT name, COUNT(*) as frequency, MAX(timestamp) as last_seen
      FROM sightings
      WHERE timestamp > datetime('now', '-${hours} hours')
      GROUP BY name
      ORDER BY last_seen DESC
    `);

    const results = query.all() as any[];
    if (results.length === 0) return "No one has been seen recently.";

    return results
      .map(
        (r) =>
          `${r.name} (seen ${r.frequency} times, last at ${new Date(r.last_seen).toLocaleTimeString()})`,
      )
      .join(", ");
  }
}
