import { useState, useRef, useEffect } from "react";

export interface SidecarMessage {
  role: "user" | "assistant";
  text: string;
}

interface AISidecarProps {
  messages: SidecarMessage[];
  isThinking: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

export function AISidecar({
  messages,
  isThinking,
  collapsed,
  onToggle,
  onSend,
  onInterrupt,
}: AISidecarProps) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  function submit() {
    const text = input.trim();
    if (!text || isThinking) return;
    onSend(text);
    setInput("");
  }

  return (
    <div className={`ai-sidecar${collapsed ? " collapsed" : ""}`}>
      <div className="sidecar-header">
        {!collapsed && <span className="sidecar-title">Episteme AI</span>}
        <button className="sidecar-toggle" onClick={onToggle} title={collapsed ? "Expand" : "Collapse"}>
          {collapsed ? "◀" : "▶"}
        </button>
      </div>

      {!collapsed && (
        <>
          <div className="sidecar-messages">
            {messages.length === 0 && (
              <div style={{ color: "var(--text-dim)", fontSize: 12, textAlign: "center", marginTop: 20 }}>
                Ask Episteme anything about your document or workspace.
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`sidecar-msg ${m.role}`}>
                <div className="sidecar-msg-role">{m.role === "user" ? "You" : "Episteme"}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
              </div>
            ))}
            {isThinking && (
              <div className="sidecar-thinking">Thinking…</div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="sidecar-input-row">
            <textarea
              className="sidecar-input"
              value={input}
              placeholder="Ask about your document…"
              rows={2}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              disabled={isThinking}
              style={{ resize: "none" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <button
                className="sidecar-send"
                onClick={submit}
                disabled={isThinking || !input.trim()}
              >
                Send
              </button>
              {isThinking && (
                <button
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    background: "var(--bg-highlight)",
                    color: "var(--red)",
                    fontSize: 11,
                    border: "1px solid var(--border-light)",
                  }}
                  onClick={onInterrupt}
                >
                  Stop
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
