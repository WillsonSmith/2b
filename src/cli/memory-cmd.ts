import { Database } from "bun:sqlite";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { APP_DATA_DIR } from "../paths.ts";

const BOLD = "\x1b[1m", RESET = "\x1b[0m", GRAY = "\x1b[90m", CYAN = "\x1b[36m", RED = "\x1b[31m";

const DB_PATH = join(APP_DATA_DIR, "data", "2b.cortex.sqlite");

function openDb(): Database {
  if (!existsSync(DB_PATH)) {
    console.error(`No memory database found at ${DB_PATH}`);
    console.error("Run 2b at least once to create it.");
    process.exit(1);
  }
  return new Database(DB_PATH);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function printRows(rows: { id: string; type: string; timestamp: number; text: string }[]): void {
  for (const row of rows) {
    console.log(
      `${GRAY}${row.id.slice(0, 8)}${RESET}  ${CYAN}${row.type.padEnd(12)}${RESET}  ${GRAY}${formatDate(row.timestamp)}${RESET}`
    );
    console.log(`  ${truncate(row.text, 80)}\n`);
  }
}

function listMemories(db: Database): void {
  const rows = db
    .prepare("SELECT id, type, timestamp, text FROM memories ORDER BY timestamp DESC")
    .all() as { id: string; type: string; timestamp: number; text: string }[];

  if (rows.length === 0) {
    console.log("No memories stored.");
    return;
  }

  console.log(`\n${BOLD}${rows.length} memories${RESET}\n`);
  printRows(rows);
}

function searchMemories(db: Database, query: string): void {
  const rows = db
    .prepare(
      `SELECT m.id, m.type, m.timestamp, m.text
       FROM memories m
       INNER JOIN memories_fts f ON m.id = f.memory_id
       WHERE memories_fts MATCH ?
       ORDER BY m.timestamp DESC`
    )
    .all(query) as { id: string; type: string; timestamp: number; text: string }[];

  if (rows.length === 0) {
    console.log(`No memories matching "${query}".`);
    return;
  }

  console.log(`\n${BOLD}${rows.length} result${rows.length === 1 ? "" : "s"} for "${query}"${RESET}\n`);
  printRows(rows);
}

async function clearMemories(db: Database, force: boolean): Promise<void> {
  const { count } = db
    .prepare("SELECT COUNT(*) as count FROM memories")
    .get() as { count: number };

  if (count === 0) {
    console.log("No memories to clear.");
    return;
  }

  if (!force) {
    process.stdout.write(`Clear all ${count} ${count === 1 ? "memory" : "memories"}? ${BOLD}[y/N]${RESET} `);
    const answer = await new Promise<string>((resolve) => {
      process.stdin.setEncoding("utf-8");
      process.stdin.once("data", (data) => resolve(data.toString().trim()));
    });
    if (answer.toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }
  }

  db.prepare("DELETE FROM memory_links").run();
  db.prepare("DELETE FROM memories_fts").run();
  db.prepare("DELETE FROM memories").run();
  console.log(`${RED}Cleared ${count} ${count === 1 ? "memory" : "memories"}.${RESET}`);
}

export async function runMemoryCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    console.log(`
${BOLD}2b memory${RESET} — inspect and manage agent memory

${BOLD}COMMANDS${RESET}
  2b memory list                List all stored memories
  2b memory search <query>      Search memories by text
  2b memory clear [--force]     Delete all memories
`);
    return;
  }

  if (sub === "list") {
    const db = openDb();
    listMemories(db);
    db.close();
    return;
  }

  if (sub === "search") {
    const query = args.slice(1).join(" ");
    if (!query) {
      console.error("Usage: 2b memory search <query>");
      process.exit(1);
    }
    const db = openDb();
    searchMemories(db, query);
    db.close();
    return;
  }

  if (sub === "clear") {
    const force = args.includes("--force");
    const db = openDb();
    await clearMemories(db, force);
    db.close();
    return;
  }

  console.error(`Unknown memory subcommand: ${sub}`);
  console.error("Run '2b memory --help' for usage.");
  process.exit(1);
}
