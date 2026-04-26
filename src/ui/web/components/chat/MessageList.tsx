import type React from "react";
import type { ChatMessage } from "../../../types.ts";
import { MessageItem } from "./MessageItem.tsx";

export function MessageList({
  messages,
  showReasoning,
  messagesEndRef,
}: {
  messages: ChatMessage[];
  showReasoning: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="messages">
      {messages.map((msg) => (
        <MessageItem key={msg.id} message={msg} showReasoning={showReasoning} />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}
