import type { ChatSession } from "../ChatSession.ts";

export interface SlashCommandContext {
  session: ChatSession;
  showReasoning: boolean;
  setShowReasoning: (v: boolean) => void;
  showTools: boolean;
  setShowTools: (v: boolean) => void;
  currentModel: string;
  setCurrentModel: (model: string) => void;
  onModelChange: (model: string) => void;
  systemPrompt: string;
}

const HELP_TEXT = `Available slash commands:
  /help              — show this list
  /clear             — clear the chat display
  /reasoning         — toggle reasoning/thinking display
  /tools             — toggle tool call display
  /model [name]      — show current model or switch to a new one
  /retry             — resend the last user message
  /copy              — copy the last response to clipboard
  /export [filename] — save the conversation to a file
  /system            — show the current system prompt`;

/**
 * Handles slash commands typed into the input bar.
 * Returns true if the input was a slash command (do not send to agent).
 * Returns false if the input should be forwarded to the agent as a normal message.
 */
export function handleSlashCommand(input: string, ctx: SlashCommandContext): boolean {
  if (!input.startsWith("/")) return false;

  const parts = input.slice(1).trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() ?? "";
  const args = parts.slice(1);

  switch (command) {
    case "help":
    case "?":
      ctx.session.addSystemMessage(HELP_TEXT);
      return true;

    case "clear":
      ctx.session.clear();
      return true;

    case "reasoning": {
      const next = !ctx.showReasoning;
      ctx.setShowReasoning(next);
      ctx.session.addSystemMessage(`Reasoning display: ${next ? "on" : "off"}`);
      return true;
    }

    case "tools": {
      const next = !ctx.showTools;
      ctx.setShowTools(next);
      ctx.session.addSystemMessage(`Tool call display: ${next ? "on" : "off"}`);
      return true;
    }

    case "model": {
      const name = args[0];
      if (!name) {
        ctx.session.addSystemMessage(`Current model: ${ctx.currentModel}\nUsage: /model <name>`);
        return true;
      }
      ctx.onModelChange(name);
      ctx.setCurrentModel(name);
      ctx.session.addSystemMessage(`Switched to model: ${name}`);
      return true;
    }

    case "retry": {
      const lastUser = [...ctx.session.messages]
        .reverse()
        .find((m) => m.role === "user");
      if (!lastUser) {
        ctx.session.addSystemMessage("No previous message to retry.");
        return true;
      }
      ctx.session.send(lastUser.content);
      return true;
    }

    case "copy": {
      const lastAssistant = [...ctx.session.messages]
        .reverse()
        .find((m) => m.role === "assistant" && m.status === "complete" && m.content.length > 0);
      if (!lastAssistant) {
        ctx.session.addSystemMessage("No response to copy.");
        return true;
      }
      copyToClipboard(lastAssistant.content).then((ok) => {
        ctx.session.addSystemMessage(ok ? "Copied to clipboard." : "Failed to copy — clipboard tool not available.");
      });
      return true;
    }

    case "export": {
      const filename = args[0] ?? `2b-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.txt`;
      exportConversation(ctx.session, filename).then((ok) => {
        ctx.session.addSystemMessage(ok ? `Conversation saved to ${filename}` : `Failed to save to ${filename}`);
      });
      return true;
    }

    case "system":
      ctx.session.addSystemMessage(`System prompt:\n\n${ctx.systemPrompt}`);
      return true;

    default:
      ctx.session.addSystemMessage(`Unknown command: /${command}\nType /help for available commands.`);
      return true;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const cmd =
      process.platform === "darwin" ? "pbcopy"
      : process.platform === "win32" ? "clip"
      : "xclip -selection clipboard";

    const [bin, ...binArgs] = cmd.split(" ");
    if (!bin) return false;

    const proc = Bun.spawn([bin, ...binArgs], { stdin: "pipe" });
    proc.stdin.write(text);
    proc.stdin.end();
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function exportConversation(session: ChatSession, filename: string): Promise<boolean> {
  try {
    const lines: string[] = [];
    for (const msg of session.messages) {
      if (msg.role === "system") continue;
      const label = msg.role === "user" ? "You" : "2b";
      lines.push(`${label}:\n${msg.content}`);
    }
    await Bun.write(filename, lines.join("\n\n") + "\n");
    return true;
  } catch {
    return false;
  }
}
