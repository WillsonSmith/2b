// macOS-only plugin: requires pbpaste and pbcopy in PATH (darwin only).
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

export class ClipboardPlugin implements AgentPlugin {
  name = "Clipboard";

  getSystemPromptFragment(): string {
    return `You can read and write the macOS clipboard.
Use read_clipboard when the user asks what's on their clipboard or wants you to work with copied content.
Use write_clipboard when the user asks you to copy something or put text on the clipboard.
Note: clipboard contents may include sensitive data such as passwords or tokens — only use what is necessary.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "read_clipboard",
        description: "Read the current text contents of the macOS clipboard. Use this when the user says 'from my clipboard', 'what did I copy', or asks you to use clipboard content.",
        parameters: { type: "object", properties: {}, required: [] },
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

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "read_clipboard") {
      logger.debug("Clipboard", "read_clipboard");
      const proc = Bun.spawn(["pbpaste"], { stdout: "pipe", stderr: "ignore" });
      const content = await new Response(proc.stdout).text();
      await proc.exited;
      if (proc.exitCode !== 0) {
        logger.warn("Clipboard", `read_clipboard: pbpaste exited with code ${proc.exitCode}`);
      }
      return { content };
    }

    if (name === "write_clipboard") {
      const text = args.text;
      if (typeof text !== "string") {
        throw new TypeError(`write_clipboard: expected args.text to be a string, got ${typeof text}`);
      }
      const preview = text.length > 50 ? `${text.slice(0, 50)}...` : text;
      logger.debug("Clipboard", `write_clipboard: ${preview}`);
      const proc = Bun.spawn(["pbcopy"], {
        stdin: new Blob([text]),
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;
      if (proc.exitCode !== 0) {
        throw new Error(`write_clipboard: pbcopy exited with code ${proc.exitCode}`);
      }
      return { success: true, characters_written: text.length };
    }

    return undefined;
  }
}
