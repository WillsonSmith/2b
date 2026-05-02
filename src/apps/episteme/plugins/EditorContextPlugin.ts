import type { AgentPlugin } from "../../../core/Plugin.ts";

/** Maximum characters of document content injected into the agent context per turn. */
const CONTENT_BUDGET = 6000;

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
    return "The user is currently editing a Markdown document. Its content is injected into your context each turn. When answering, take the current document into account.";
  }

  getContext(): string {
    if (!this.currentFile) return "";
    const preview =
      this.currentContent.length > CONTENT_BUDGET
        ? this.currentContent.slice(0, CONTENT_BUDGET) + "\n...[document truncated]"
        : this.currentContent;
    return `[Current Document: ${this.currentFile}]\n${preview}`;
  }
}
