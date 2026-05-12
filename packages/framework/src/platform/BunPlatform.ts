import type { IPlatform } from "./IPlatform.ts";
import type { IDatabase } from "./IDatabase.ts";
import { BunDatabase } from "./BunDatabase.ts";
import { BunFileSystem } from "./BunFileSystem.ts";

export class BunPlatform implements IPlatform {
  fs = new BunFileSystem();

  openDatabase(path: string): IDatabase {
    return new BunDatabase(path);
  }
}

export const bunPlatform: IPlatform = new BunPlatform();
