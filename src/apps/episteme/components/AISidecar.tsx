import { useState, useRef, useEffect, useCallback } from "react";
import { MarkdownView } from "./MarkdownView.tsx";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SidecarMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; name: string; status: "calling" | "done" };

interface AISidecarProps {
  messages: SidecarMessage[];
  isThinking: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EXECUTE_PROMPT =
  "Please proceed and execute the plan you outlined above. Use your available tools — search sources, create documents, or take whatever actions are needed to complete each step.";

const QUICK_ACTIONS: Array<{ label: string; prompt: string }> = [
  {
    label: "Wikipedia Research",
    prompt:
      "Search Wikipedia for the main topics in my current document. Summarize the key findings and save them as a new workspace document.",
  },
  {
    label: "arXiv Papers",
    prompt:
      "Search arXiv for academic papers related to the topics in my current document. Save a structured summary of the most relevant findings.",
  },
  {
    label: "Summarize Workspace",
    prompt:
      "Read all documents in the workspace and produce a comprehensive summary of the key themes, main arguments, and connections between them.",
  },
  {
    label: "Find Connections",
    prompt:
      "Identify meaningful connections, overlapping topics, and relationships between all documents in the workspace. List the most significant ones.",
  },
];

function toolDisplayName(name: string): string {
  return name.replace(/_/g, " ");
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable
    }
  }, [text]);

  return (
    <button className="sidecar-copy-btn" onClick={handleCopy} title="Copy to clipboard">
      {copied ? "✓" : "⎘"}
    </button>
  );
}

// ── MessageList ───────────────────────────────────────────────────────────────

interface MessageListProps {
  messages: SidecarMessage[];
  isThinking: boolean;
  onSend: (text: string) => void;
  endRef: React.MutableRefObject<HTMLDivElement | null>;
}

function MessageList({ messages, isThinking, onSend, endRef }: MessageListProps) {
  return (
    <div className="sidecar-messages">
      {messages.length === 0 && (
        <div className="sidecar-empty">
          Ask Episteme anything, or use Quick Actions to kick off a research task.
        </div>
      )}

      {messages.map((m, i) => {
        if (m.role === "tool") {
          return (
            <div key={i} className={`sidecar-tool-row ${m.status}`}>
              <span className="sidecar-tool-arrow">↳</span>
              <span className="sidecar-tool-name">{toolDisplayName(m.name)}</span>
              <span className="sidecar-tool-status">
                {m.status === "calling" ? "…" : "✓"}
              </span>
            </div>
          );
        }

        if (m.role === "assistant") {
          return (
            <div key={i} className="sidecar-msg assistant">
              <div className="sidecar-msg-header">
                <span className="sidecar-msg-role">Episteme</span>
                <CopyButton text={m.text} />
              </div>
              <MarkdownView content={m.text} className="sidecar-msg-markdown" />
              <div className="sidecar-msg-actions">
                <button
                  className="sidecar-action-btn primary"
                  title="Execute the plan above using available tools"
                  onClick={() => onSend(EXECUTE_PROMPT)}
                >
                  Execute →
                </button>
                <button
                  className="sidecar-action-btn"
                  title="Ask the agent to continue"
                  onClick={() => onSend("Please continue.")}
                >
                  Continue
                </button>
              </div>
            </div>
          );
        }

        return (
          <div key={i} className="sidecar-msg user">
            <div className="sidecar-msg-header">
              <span className="sidecar-msg-role">You</span>
            </div>
            <div className="sidecar-msg-user-text">{m.text}</div>
          </div>
        );
      })}

      {isThinking && <div className="sidecar-thinking">Thinking…</div>}
      <div ref={endRef} />
    </div>
  );
}

// ── ChatInput ─────────────────────────────────────────────────────────────────

interface ChatInputProps {
  isThinking: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
}

function ChatInput({ isThinking, onSend, onInterrupt }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [showQuickActions, setShowQuickActions] = useState(false);

  function submit() {
    const text = input.trim();
    if (!text || isThinking) return;
    onSend(text);
    setInput("");
  }

  return (
    <div className="sidecar-input-area">
      {showQuickActions && (
        <div className="sidecar-quick-actions">
          <div className="sidecar-quick-heading">Quick Actions</div>
          <div className="sidecar-quick-grid">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                className="sidecar-quick-btn"
                onClick={() => {
                  setInput(a.prompt);
                  setShowQuickActions(false);
                }}
                title={a.prompt}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sidecar-input-row">
        <button
          className={`sidecar-quick-toggle${showQuickActions ? " active" : ""}`}
          onClick={() => setShowQuickActions((v) => !v)}
          title="Quick action commands"
        >
          ⚡
        </button>
        <textarea
          className="sidecar-input"
          value={input}
          placeholder="Ask or give a task…"
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
            <button className="sidecar-interrupt" onClick={onInterrupt}>
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ChatModal (expanded view) ─────────────────────────────────────────────────

interface ChatModalProps {
  messages: SidecarMessage[];
  isThinking: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onClose: () => void;
}

function ChatModal({ messages, isThinking, onSend, onInterrupt, onClose }: ChatModalProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-chat-expanded" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Episteme AI</span>
          <button className="modal-close" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="chat-modal-body">
          <MessageList
            messages={messages}
            isThinking={isThinking}
            onSend={onSend}
            endRef={endRef}
          />
        </div>
        <ChatInput isThinking={isThinking} onSend={onSend} onInterrupt={onInterrupt} />
      </div>
    </div>
  );
}

// ── AISidecar ─────────────────────────────────────────────────────────────────

export function AISidecar({
  messages,
  isThinking,
  collapsed,
  onToggle,
  onSend,
  onInterrupt,
}: AISidecarProps) {
  const [expanded, setExpanded] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  return (
    <>
      <div className={`ai-sidecar${collapsed ? " collapsed" : ""}`}>
        <div className="sidecar-header">
          {!collapsed && <span className="sidecar-title">Episteme AI</span>}
          {!collapsed && (
            <button
              className="sidecar-expand-btn"
              onClick={() => setExpanded(true)}
              title="Open full-screen chat"
            >
              ⤢
            </button>
          )}
          <button
            className="sidecar-toggle"
            onClick={onToggle}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "◀" : "▶"}
          </button>
        </div>

        {!collapsed && (
          <>
            <MessageList
              messages={messages}
              isThinking={isThinking}
              onSend={onSend}
              endRef={endRef}
            />
            <ChatInput isThinking={isThinking} onSend={onSend} onInterrupt={onInterrupt} />
          </>
        )}
      </div>

      {expanded && (
        <ChatModal
          messages={messages}
          isThinking={isThinking}
          onSend={onSend}
          onInterrupt={onInterrupt}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}
