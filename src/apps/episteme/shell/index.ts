import type { IShell } from "./IShell.ts";
import { BrowserShell } from "./BrowserShell.ts";
import { ElectronShell } from "./ElectronShell.ts";

export function getShell(): IShell {
  if (typeof window !== "undefined" && (window as any).__electronShell) {
    return new ElectronShell();
  }
  return new BrowserShell();
}

export type { IShell };
