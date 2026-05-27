import type { Scope } from "./types.ts";

export const SCOPES: ReadonlyArray<Scope> = ["files", "fulltext", "research", "commands"];

export const SCOPE_LABELS: Record<Scope, string> = {
  files: "Files",
  fulltext: "Full-text",
  research: "Research",
  commands: "Commands",
};

export const PLACEHOLDERS: Record<Scope, string> = {
  files: "Find file…",
  fulltext: "Search in notes…",
  research: "Search arXiv, Wikipedia, workspace…",
  commands: "> command",
};

export const CLOSE_ANIMATION_MS = 180;
