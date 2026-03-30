import { useEffect, useState, useCallback } from "react";
import { Box, Static, useInput, useApp } from "ink";
import type { ChatSession } from "../ChatSession.ts";
import type { ChatMessage, AgentState } from "../types.ts";
import { MessageItem } from "./MessageItem.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { InputBar } from "./InputBar.tsx";
import { handleSlashCommand } from "./slashCommands.ts";

interface TerminalChatProps {
  session: ChatSession;
  model?: string;
  systemPrompt?: string;
  onModelChange?: (model: string) => void;
}

export function TerminalChat({ session, model = "", systemPrompt = "", onModelChange }: TerminalChatProps) {
  const { exit } = useApp();

  // Completed messages go into Static — rendered once, never re-painted.
  const [completedMessages, setCompletedMessages] = useState<ChatMessage[]>([]);
  // The current in-flight assistant message is rendered outside Static so it updates live.
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);

  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [activeToolCall, setActiveToolCall] = useState<string | undefined>();
  const [input, setInput] = useState("");

  // Toggles — only affect the streaming message and new messages
  const [showReasoning, setShowReasoning] = useState(true);
  const [showTools, setShowTools] = useState(true);
  const [currentModel, setCurrentModel] = useState(model);

  // Wire up ChatSession events
  useEffect(() => {
    const onMessage = (msg: ChatMessage) => {
      if (msg.role === "user" || msg.role === "system") {
        setCompletedMessages((prev) => [...prev, msg]);
      } else {
        // Assistant placeholder — show in the live area
        setStreamingMessage({ ...msg });
      }
    };

    const onMessageUpdated = (msg: ChatMessage) => {
      if (msg.status === "complete" || msg.status === "error") {
        setCompletedMessages((prev) => [...prev, msg]);
        setStreamingMessage(null);
        setActiveToolCall(undefined);
      } else {
        setStreamingMessage({ ...msg });
        if (msg.toolCalls.length > 0) {
          setActiveToolCall(msg.toolCalls[msg.toolCalls.length - 1]?.name);
        }
      }
    };

    const onStateChange = (state: AgentState) => {
      setAgentState(state);
      if (state === "idle") setActiveToolCall(undefined);
    };

    session.on("message", onMessage);
    session.on("message_updated", onMessageUpdated);
    session.on("state_change", onStateChange);

    return () => {
      session.off("message", onMessage);
      session.off("message_updated", onMessageUpdated);
      session.off("state_change", onStateChange);
    };
  }, [session]);

  const handleSubmit = useCallback(
    (text: string) => {
      setInput("");

      const handled = handleSlashCommand(text, {
        session,
        showReasoning,
        setShowReasoning,
        showTools,
        setShowTools,
        currentModel,
        setCurrentModel,
        onModelChange: onModelChange ?? (() => {}),
        systemPrompt,
      });

      if (!handled) {
        session.send(text);
      }
    },
    [session, showReasoning, showTools, currentModel, onModelChange, systemPrompt],
  );

  // Ctrl+C → exit, Ctrl+X → interrupt current response
  useInput((inp, key) => {
    if (key.ctrl && inp === "c") {
      session.interrupt();
      exit();
    }
    if (key.ctrl && inp === "x") {
      session.interrupt();
    }
  });

  const isThinking = agentState === "thinking";

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Completed messages — painted once and never re-rendered */}
      <Static items={completedMessages}>
        {(msg) => <MessageItem key={msg.id} message={msg} />}
      </Static>

      {/* Live streaming message */}
      {streamingMessage && (
        <MessageItem
          message={streamingMessage}
          showReasoning={showReasoning}
          showTools={showTools}
        />
      )}

      {/* Status + input */}
      <StatusBar state={agentState} activeToolCall={activeToolCall} model={currentModel} />
      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={isThinking}
      />
    </Box>
  );
}
