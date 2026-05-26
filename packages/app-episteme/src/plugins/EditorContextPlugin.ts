import type { AgentPlugin } from "@2b/framework/core/Plugin.ts";

/** Half-window of document content injected around the cursor (bytes per side). */
const WINDOW_HALF = 3000;
const ELISION_MARKER = "[...truncated...]";

export class EditorContextPlugin implements AgentPlugin {
  name = "EditorContext";

  private currentFile: string | null = null;
  private currentContent: string = "";
  private currentCursor: number = 0;

  /** Called by the WebSocket handler whenever the editor state changes. */
  setEditorState(file: string, content: string, cursor: number): void {
    this.currentFile = file;
    this.currentContent = content;
    this.currentCursor = cursor;
  }

  get activeFile(): string | null { return this.currentFile; }
  get activeContent(): string { return this.currentContent; }

  getSystemPromptFragment(): string {
    if (!this.currentFile) return "";
    return [
      "The user is currently editing a Markdown document — the active document. Its content is injected into your context each turn. When answering, take the active document into account.",
      "When generating or inserting content into the active document, match the heading depth, formatting style, and voice of the surrounding text. Do not add parenthetical annotations to headings or impose structural conventions not already present in the document.",
    ].join("\n");
  }

  getContext(): string {
    if (!this.currentFile) return "";
    return `[Active Document: ${this.currentFile}]\n${this.windowedContent()}`;
  }

  private windowedContent(): string {
    const total = this.currentContent.length;
    if (total <= WINDOW_HALF * 2) return this.currentContent;

    const cursor = Math.max(0, Math.min(this.currentCursor, total));
    const start = Math.max(0, cursor - WINDOW_HALF);
    const end = Math.min(total, cursor + WINDOW_HALF);
    const middle = this.currentContent.slice(start, end);
    const head = start > 0 ? `${ELISION_MARKER}\n` : "";
    const tail = end < total ? `\n${ELISION_MARKER}` : "";
    return `${head}${middle}${tail}`;
  }
}
