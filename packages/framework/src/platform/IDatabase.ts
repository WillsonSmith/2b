export interface IRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface IStatement {
  run(...params: unknown[]): IRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface IDatabase {
  /** Execute a SQL statement (DDL or DML with no return value). */
  exec(sql: string, params?: unknown[]): void;
  /** Prepare a SQL statement for repeated execution. */
  prepare(sql: string): IStatement;
  /** Alias for prepare — matches bun:sqlite's db.query() API. */
  query(sql: string): IStatement;
  /** Wrap a function in a database transaction. Returns a callable that runs fn inside a transaction. */
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  close(): void;
}
