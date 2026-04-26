import type React from "react";
import { useCallback, useRef, useState } from "react";
import type { AgentState } from "../../../types.ts";

export function ChatInput({
  isBlocked,
  agentState,
  onSubmit,
}: {
  isBlocked: boolean;
  agentState: AgentState;
  onSubmit: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    onSubmit(text);
  }, [input, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="input-area">
      <div className="input-row">
        <textarea
          ref={inputRef}
          className="input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isBlocked
              ? agentState === "thinking"
                ? "thinking…"
                : "waiting for permission…"
              : "Type a message… (/ for commands)"
          }
          disabled={isBlocked}
          rows={1}
        />
        <button
          className="send-btn"
          onClick={handleSubmit}
          disabled={isBlocked || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
