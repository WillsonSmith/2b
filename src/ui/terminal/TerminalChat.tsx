import { useEffect, useState, useCallback } from "react";
import { Box, Static, useInput, useApp } from "ink";
import type { ChatSession } from "../ChatSession.ts";
import type { ChatMessage, AgentState } from "../types.ts";
import { MessageItem } from "./MessageItem.tsx";
import { StatusBar } from "./StatusBar.tsx";
import { InputBar } from "./InputBar.tsx";

interface TerminalChatProps {
  session: ChatSession;
  model?: string;
}

export function TerminalChat({ session, model }: TerminalChatProps) {
  const { exit } = useApp();

  // Completed messages go into Static — rendered once, never re-painted.
  const [completedMessages, setCompletedMessages] = useState<ChatMessage[]>([]);
  // The current in-flight assistant message is rendered outside Static so it updates live.
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);

  const [agentState, setAgentState] = useState<AgentState>("idle");
  const [activeToolCall, setActiveToolCall] = useState<string | undefined>();
  const [input, setInput] = useState("");

  // Wire up ChatSession events
  useEffect(() => {
    const onMessage = (msg: ChatMessage) => {
      if (msg.role === "user") {
        // User messages are always complete immediately
        setCompletedMessages((prev) => [...prev, msg]);
      } else {
        // Assistant placeholder — show in the live area
        setStreamingMessage({ ...msg });
      }
    };

    const onMessageUpdated = (msg: ChatMessage) => {
      if (msg.status === "complete" || msg.status === "error") {
        // Move to the static list
        setCompletedMessages((prev) => [...prev, msg]);
        setStreamingMessage(null);
        setActiveToolCall(undefined);
      } else {
        setStreamingMessage({ ...msg });
        // Track the most recent tool call for the status bar
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
      session.send(text);
    },
    [session],
  );

  // Ctrl+C → exit, Ctrl+X → interrupt current response
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      session.interrupt();
      exit();
    }
    if (key.ctrl && input === "x") {
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
      {streamingMessage && <MessageItem message={streamingMessage} />}

      {/* Status + input */}
      <StatusBar state={agentState} activeToolCall={activeToolCall} model={model} />
      <InputBar
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        disabled={isThinking}
      />
    </Box>
  );
}
