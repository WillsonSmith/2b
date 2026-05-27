export type Scope = "files" | "fulltext" | "research" | "commands";

export interface SearchCommand {
  id: string;
  label: string;
  description?: string;
  action: () => void;
}

export interface FullTextResult {
  path: string;
  matches: Array<{ line: number; text: string }>;
}
