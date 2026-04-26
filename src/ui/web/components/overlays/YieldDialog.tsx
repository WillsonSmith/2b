import { useCallback, useRef, useState } from "react";
import type { YieldRequest } from "../../types.ts";

export function YieldDialog({
  request,
  onRespond,
}: {
  request: YieldRequest;
  onRespond: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onRespond(trimmed);
    setText("");
  }, [text, onRespond]);

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
    <div className="permission-overlay">
      <div className="permission-dialog yield-dialog">
        <div className="permission-title yield-title">Agent is waiting for your input</div>
        {request.reason && (
          <div className="permission-field">
            <span className="permission-field-label">Needs: </span>
            <span className="permission-field-value">{request.reason}</span>
          </div>
        )}
        {request.partialResult && (
          <div className="permission-field">
            <span className="permission-field-label">Partial result:</span>
            <pre className="permission-args">{request.partialResult}</pre>
          </div>
        )}
        <textarea
          ref={inputRef}
          className="yield-input"
          placeholder="Type your response... (Enter to send, Shift+Enter for newline)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          autoFocus
        />
        <div className="permission-buttons">
          <button
            className="perm-btn perm-btn--yes"
            onClick={handleSubmit}
            disabled={!text.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
