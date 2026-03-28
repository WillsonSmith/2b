import { Database } from "bun:sqlite";
import { join } from "node:path";
import { APP_DATA_DIR } from "../paths.ts";

const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";
const GRAY = "\x1b[90m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";

const DB_PATH = join(APP_DATA_DIR, "data", "2b.cortex.sqlite");

interface MemoryRow {
  id: string;
  type: string;
  timestamp: number;
  text: string;
}

async function openDb(): Promise<Database> {
  if (!(await Bun.file(DB_PATH).exists())) {
    throw new Error(`No memory database found at ${DB_PATH}\nRun 2b at least once to create it.`);
  }
  return new Database(DB_PATH);
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function printRows(rows: MemoryRow[]): void {
  for (const row of rows) {
    console.log(
      `${GRAY}${row.id.slice(0, 8)}${RESET}  ${CYAN}${row.type.padEnd(12)}${RESET}  ${GRAY}${formatDate(row.timestamp)}${RESET}`
    );
    console.log(`  ${truncate(row.text, 80)}\n`);
  }
}

const LIST_LIMIT = 100;

function listMemories(db: Database): void {
  const rows = db
    .prepare(`SELECT id, type, timestamp, text FROM memories ORDER BY timestamp DESC LIMIT ${LIST_LIMIT + 1}`)
    .all() as MemoryRow[];

  if (rows.length === 0) {
    console.log("No memories stored.");
    return;
  }

  const truncated = rows.length > LIST_LIMIT;
  const display = truncated ? rows.slice(0, LIST_LIMIT) : rows;
  console.log(`\n${BOLD}${display.length}${truncated ? "+" : ""} memories${RESET}\n`);
  printRows(display);
  if (truncated) {
    console.log(`${GRAY}(showing first ${LIST_LIMIT}; use 'search' to narrow results)${RESET}\n`);
  }
}

function searchMemories(db: Database, query: string): void {
  let rows: MemoryRow[];
  try {
    rows = db
      .prepare(
        `SELECT m.id, m.type, m.timestamp, m.text
         FROM memories m
         INNER JOIN memories_fts f ON m.id = f.memory_id
         WHERE memories_fts MATCH ?
         ORDER BY m.timestamp DESC`
      )
      .all(query) as MemoryRow[];
  } catch {
    console.error(`Search failed: invalid query syntax. Try simpler terms.`);
    process.exit(1);
  }

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
      process.stdin.once("data", (data) => {
        process.stdin.pause();
        resolve(data.toString().trim());
      });
    });
    if (answer.toLowerCase() !== "y") {
      console.log("Aborted.");
      return;
    }
  }

  db.transaction(() => {
    db.prepare("DELETE FROM memory_links").run();
    db.prepare("DELETE FROM memories_fts").run();
    db.prepare("DELETE FROM memories").run();
  })();
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

  switch (sub) {
    case "list": {
      const db = await openDb();
      try {
        listMemories(db);
      } finally {
        db.close();
      }
      return;
    }

    case "search": {
      const query = args.slice(1).join(" ");
      if (!query) {
        console.error("Usage: 2b memory search <query>");
        process.exit(1);
      }
      const db = await openDb();
      try {
        searchMemories(db, query);
      } finally {
        db.close();
      }
      return;
    }

    case "clear": {
      const force = args.includes("--force");
      const db = await openDb();
      try {
        await clearMemories(db, force);
      } finally {
        db.close();
      }
      return;
    }

    default:
      console.error(`Unknown memory subcommand: ${sub}`);
      console.error("Run '2b memory --help' for usage.");
      process.exit(1);
  }
}
