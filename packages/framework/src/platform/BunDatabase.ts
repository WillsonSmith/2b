import { Database, type SQLQueryBindings, type Statement } from "bun:sqlite";
import type { IDatabase, IRunResult, IStatement } from "./IDatabase.ts";

class BunStatement implements IStatement {
  private stmt: Statement<unknown, SQLQueryBindings[]>;

  constructor(stmt: Statement<unknown, SQLQueryBindings[]>) {
    this.stmt = stmt;
  }

  run(...params: unknown[]): IRunResult {
    const r = this.stmt.run(...(params as SQLQueryBindings[]));
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  }

  get(...params: unknown[]): unknown {
    return this.stmt.get(...(params as SQLQueryBindings[]));
  }

  all(...params: unknown[]): unknown[] {
    return this.stmt.all(...(params as SQLQueryBindings[])) as unknown[];
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
