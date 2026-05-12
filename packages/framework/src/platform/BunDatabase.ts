import { Database, type Statement } from "bun:sqlite";
import type { IDatabase, IRunResult, IStatement } from "./IDatabase.ts";

class BunStatement implements IStatement {
  // bun:sqlite Statement is generic; we erase it here since IStatement is untyped
  private stmt: Statement<unknown, unknown[]>;

  constructor(stmt: Statement<unknown, unknown[]>) {
    this.stmt = stmt;
  }

  run(...params: unknown[]): IRunResult {
    const r = (this.stmt as unknown as Statement<unknown, unknown>).run(...(params as Parameters<typeof this.stmt.run>));
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  }

  get(...params: unknown[]): unknown {
    return (this.stmt as unknown as Statement<unknown, unknown>).get(...(params as Parameters<typeof this.stmt.get>));
  }

  all(...params: unknown[]): unknown[] {
    return (this.stmt as unknown as Statement<unknown, unknown[]>).all(...(params as Parameters<typeof this.stmt.all>)) as unknown[];
  }
}

export class BunDatabase implements IDatabase {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
  }

  exec(sql: string, params?: unknown[]): void {
    if (params && params.length > 0) {
      this.db.run(sql, params as Parameters<typeof this.db.run>[1]);
    } else {
      this.db.run(sql);
    }
  }

  prepare(sql: string): IStatement {
    return new BunStatement(this.db.prepare(sql));
  }

  query(sql: string): IStatement {
    return this.prepare(sql);
  }

  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }
}
