import { join, resolve } from "node:path";
import type { AgentPlugin, ToolDefinition } from "../../../core/Plugin.ts";

const MAX_FRAGMENT_CHARS = 2000;

export class StyleGuidePlugin implements AgentPlugin {
  name = "StyleGuide";
  private content = "";
  private readonly guidePath: string;

  constructor(workspaceRoot: string) {
    this.guidePath = join(resolve(workspaceRoot), ".episteme", "style-guide.md");
  }

  async onInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    try {
      this.content = await Bun.file(this.guidePath).text();
    } catch {
      this.content = "";
    }
  }

  getSystemPromptFragment(): string {
    if (!this.content.trim()) return "";
    const truncated =
      this.content.length > MAX_FRAGMENT_CHARS
        ? this.content.slice(0, MAX_FRAGMENT_CHARS) + "\n...[style guide truncated]"
        : this.content;
    return `## Style Guide\nFollow these writing style rules when editing or generating text:\n\n${truncated}`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "get_style_guide",
        description: "Read the current workspace style guide.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      {
        name: "set_style_guide",
        description: "Replace the workspace style guide with new Markdown content.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "The full Markdown style guide." },
          },
          required: ["content"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "get_style_guide") {
      return this.content.trim()
        ? { content: this.content }
        : { content: "", message: "No style guide configured." };
    }
    if (name === "set_style_guide") {
      await this.save(String(args.content ?? ""));
      return { success: true };
    }
  }

  async save(content: string): Promise<void> {
    this.content = content;
    await Bun.write(this.guidePath, content);
  }

  get currentContent(): string {
    return this.content;
  }
}
