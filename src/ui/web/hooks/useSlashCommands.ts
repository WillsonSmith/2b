import { useCallback } from "react";
import type { ChatMessage } from "../../types.ts";
import { generateId, HELP_TEXT } from "../types.ts";

interface UseSlashCommandsOptions {
  messages: ChatMessage[];
  currentModel: string;
  systemPrompt: string;
  send: (msg: unknown) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setCurrentModel: React.Dispatch<React.SetStateAction<string>>;
  setShowReasoning: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useSlashCommands({
  messages,
  currentModel,
  systemPrompt,
  send,
  setMessages,
  setCurrentModel,
  setShowReasoning,
}: UseSlashCommandsOptions): (input: string) => boolean {
  return useCallback(
    (input: string): boolean => {
      if (!input.startsWith("/")) return false;
      const parts = input.slice(1).trim().split(/\s+/);
      const command = parts[0]?.toLowerCase() ?? "";
      const args = parts.slice(1);

      const addSys = (content: string) => {
        const msg: ChatMessage = {
          id: generateId(),
          role: "system",
          content,
          toolCalls: [],
          status: "complete",
          timestamp: new Date().toISOString() as unknown as Date,
        };
        setMessages((prev) => [...prev, msg]);
      };

      switch (command) {
        case "help":
        case "?":
          addSys(HELP_TEXT);
          return true;
        case "clear":
          setMessages([]);
          send({ type: "clear" });
          return true;
        case "reasoning":
          setShowReasoning((v) => {
            addSys(`Reasoning display: ${!v ? "on" : "off"}`);
            return !v;
          });
          return true;
        case "model": {
          const name = args[0];
          if (!name) {
            addSys(`Current model: ${currentModel}\nUsage: /model <name>`);
          } else {
            send({ type: "model_change", model: name });
            setCurrentModel(name);
            addSys(`Switched to model: ${name}`);
          }
          return true;
        }
        case "retry": {
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          if (!lastUser) {
            addSys("No previous message to retry.");
            return true;
          }
          send({ type: "send", text: lastUser.content });
          return true;
        }
        case "copy": {
          const lastAsst = [...messages]
            .reverse()
            .find(
              (m) =>
                m.role === "assistant" &&
                m.status === "complete" &&
                m.content.length > 0,
            );
          if (!lastAsst) {
            addSys("No response to copy.");
            return true;
          }
          navigator.clipboard.writeText(lastAsst.content).then(
            () => addSys("Copied to clipboard."),
            () => addSys("Failed to copy — clipboard permission denied."),
          );
          return true;
        }
        case "export": {
          const filename =
            args[0] ??
            `2b-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.txt`;
          const lines: string[] = [];
          for (const msg of messages) {
            if (msg.role === "system") continue;
            lines.push(`${msg.role === "user" ? "You" : "2b"}:\n${msg.content}`);
          }
          const blob = new Blob([lines.join("\n\n") + "\n"], {
            type: "text/plain",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          addSys(`Conversation saved as ${filename}`);
          return true;
        }
        case "system":
          addSys(`System prompt:\n\n${systemPrompt}`);
          return true;
        default:
          addSys(
            `Unknown command: /${command}\nType /help for available commands.`,
          );
          return true;
      }
    },
    [messages, currentModel, systemPrompt, send, setMessages, setCurrentModel, setShowReasoning],
  );
}
