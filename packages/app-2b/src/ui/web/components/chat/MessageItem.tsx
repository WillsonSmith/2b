import type { ChatMessage } from "../../../types.ts";
import { CopyButton } from "./CopyButton.tsx";
import { MarkdownContent } from "./MarkdownContent.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";

export function MessageItem({
  message,
  showReasoning,
}: {
  message: ChatMessage;
  showReasoning: boolean;
}) {
  if (message.role === "system") {
    return (
      <div className="message message--system">
        <div className="message-body">{message.content}</div>
      </div>
    );
  }

  const isUser = message.role === "user";
  const inProgress = message.status === "streaming";
  const showCopy =
    !isUser && message.status === "complete" && message.content.length > 0;

  return (
    <div
      className={`message message--${isUser ? "user" : "assistant"} message--${message.status}`}
    >
      <div className="message-label">
        {isUser ? "You" : "2b"}
        {showCopy && <CopyButton content={message.content} />}
      </div>

      {showReasoning && message.thought && (
        <ThinkingBlock thought={message.thought} inProgress={inProgress} />
      )}

      <div className="message-body">
        {message.status === "pending" ? (
          <span style={{ color: "var(--text-dim)", fontStyle: "italic" }}>
            …
          </span>
        ) : message.status === "error" ? (
          <span style={{ color: "var(--red)" }}>
            Error — something went wrong.
          </span>
        ) : isUser ? (
          <>
            {message.content.trimStart()}
            {message.status === "streaming" && (
              <span className="cursor">▌</span>
            )}
          </>
        ) : (
          <>
            <MarkdownContent content={message.content.trimStart()} />
            {message.status === "streaming" && (
              <span className="cursor">▌</span>
            )}
          </>
        )}
      </div>

      {message.toolCalls.length > 0 && (
        <div className="tool-calls">
          {message.toolCalls.map((tc, i) => (
            <div key={i} className="tool-call">
              <span className="tool-call-name">[{tc.name}]</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
