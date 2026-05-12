import type { IDatabase } from "./IDatabase.ts";
import type { IFileSystem } from "./IFileSystem.ts";

export interface IPlatform {
  fs: IFileSystem;
  openDatabase(path: string): IDatabase;
}
