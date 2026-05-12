export interface IGlobOptions {
  cwd: string;
  onlyFiles?: boolean;
  dot?: boolean;
}

export interface IFileSystem {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<ArrayBuffer>;
  /** Read a byte-range slice of a file (for binary detection). */
  readSlice(path: string, start: number, end: number): Promise<ArrayBuffer>;
  /**
   * Write content to path. Accepts string, binary data, or a fetch Response
   * (for streaming downloads). Returns bytes written.
   */
  write(path: string, content: string | Uint8Array | ArrayBuffer | Response): Promise<number>;
  exists(path: string): Promise<boolean>;
  /** Synchronous file size in bytes — matches Bun.file(path).size. */
  size(path: string): number;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  glob(pattern: string, opts: IGlobOptions): AsyncIterable<string>;
  globSync(pattern: string, cwd: string): Iterable<string>;
  /** Open a file as an async iterable byte stream. */
  stream(path: string): AsyncIterable<Uint8Array>;
}
