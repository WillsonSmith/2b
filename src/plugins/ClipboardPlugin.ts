import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

export class ClipboardPlugin implements AgentPlugin {
  name = "Clipboard";

  getSystemPromptFragment(): string {
    return `You can read and write the macOS clipboard.
Use read_clipboard when the user asks what's on their clipboard or wants you to work with copied content.
Use write_clipboard when the user asks you to copy something or put text on the clipboard.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "read_clipboard",
        description: "Read the current text contents of the macOS clipboard. Use this when the user says 'from my clipboard', 'what did I copy', or asks you to use clipboard content.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "write_clipboard",
        description: "Write text to the macOS clipboard, replacing its current contents. Use this when the user asks you to copy something or put output onto the clipboard.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "The text to copy to the clipboard.",
            },
          },
          required: ["text"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "read_clipboard") {
      logger.debug("Clipboard", "read_clipboard");
      const proc = Bun.spawn(["pbpaste"], { stdout: "pipe", stderr: "ignore" });
      const content = await new Response(proc.stdout).text();
      await proc.exited;
      return { content };
    }

    if (name === "write_clipboard") {
      logger.debug("Clipboard", `write_clipboard: ${String(args.text).slice(0, 50)}...`);
      const proc = Bun.spawn(["pbcopy"], {
        stdin: new Blob([args.text]),
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
      return { success: true, characters_written: args.text.length };
    }
  }
}
