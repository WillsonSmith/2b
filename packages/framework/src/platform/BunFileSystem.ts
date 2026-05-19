import { mkdir } from "node:fs/promises";
import type { IFileSystem, IGlobOptions } from "./IFileSystem.ts";

export class BunFileSystem implements IFileSystem {
  readText(path: string): Promise<string> {
    return Bun.file(path).text();
  }

  readBytes(path: string): Promise<ArrayBuffer> {
    return Bun.file(path).arrayBuffer();
  }

  readSlice(path: string, start: number, end: number): Promise<ArrayBuffer> {
    return Bun.file(path).slice(start, end).arrayBuffer();
  }

  write(path: string, content: string | Uint8Array | ArrayBuffer | Response): Promise<number> {
    return Bun.write(path, content as string);
  }

  async exists(path: string): Promise<boolean> {
    return Bun.file(path).exists();
  }

  size(path: string): number {
    return Bun.file(path).size;
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await mkdir(path, opts);
  }

  glob(pattern: string, opts: IGlobOptions): AsyncIterable<string> {
    return new Bun.Glob(pattern).scan({
      cwd: opts.cwd,
      onlyFiles: opts.onlyFiles,
      dot: opts.dot,
    });
  }

  globSync(pattern: string, cwd: string): Iterable<string> {
    return new Bun.Glob(pattern).scanSync(cwd);
  }

  stream(path: string): AsyncIterable<Uint8Array> {
    return Bun.file(path).stream() as unknown as AsyncIterable<Uint8Array>;
  }
}
