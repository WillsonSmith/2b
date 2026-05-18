import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { Copy, Check, CornerDownRight, Loader2, ArrowRight, ArrowUp, Zap, Maximize2, X, Square, Circle, CircleDashed, CircleDot, Trash2, AlertCircle } from "lucide-react";
import { MarkdownView } from "./MarkdownView.tsx";
import { usePanelResize } from "../hooks/usePanelResize.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SidecarMessage =
  | { role: "user"; text: string; id?: number }
  | { role: "assistant"; text: string; id?: number }
  | { role: "tool"; name: string; status: "calling" | "done" | "error"; error?: string }
  | { role: "notification"; text: string; actionLabel: string; onAction: () => void };

interface AISidecarProps {
  messages: SidecarMessage[];
  isThinking: boolean;
  agentState: string;
  collapsed: boolean;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onNavigate?: (path: string) => void;
  workspaceFiles?: string[];
  onContinueFrom?: (afterIndex: number, text: string) => void;
  onDeleteMessage?: (index: number) => void;
  pendingInput?: string;
  onPendingInputConsumed?: () => void;
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
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

// ── MessageList ───────────────────────────────────────────────────────────────

interface MessageListProps {
  messages: SidecarMessage[];
  isThinking: boolean;
  onSend: (text: string) => void;
  endRef: React.MutableRefObject<HTMLDivElement | null>;
  onNavigate?: (path: string) => void;
  onContinueFrom?: (afterIndex: number, text: string) => void;
  onDeleteMessage?: (index: number) => void;
}

const MessageList = memo(function MessageList({ messages, isThinking, onSend, endRef, onNavigate, onContinueFrom, onDeleteMessage }: MessageListProps) {
  return (
    <div className="sidecar-messages">
      {messages.length === 0 && (
        <div className="sidecar-empty">
          Ask Episteme anything, or use Quick Actions to kick off a research task.
        </div>
      )}

      {messages.map((m, i) => {
        if (m.role === "tool") {
          if (m.status === "calling") {
            return (
              <div key={i} className="sidecar-tool-row calling">
                <span className="sidecar-tool-arrow"><CornerDownRight size={10} /></span>
                <span className="sidecar-tool-name">{toolDisplayName(m.name)}</span>
                <span className="sidecar-tool-status"><Loader2 size={11} className="icon-spin" /></span>
              </div>
            );
          }
          return (
            <details key={i} className={`sidecar-tool-row ${m.status}`}>
              <summary className="sidecar-tool-summary">
                <span className="sidecar-tool-arrow"><CornerDownRight size={10} /></span>
                <span className="sidecar-tool-name">{toolDisplayName(m.name)}</span>
                <span className="sidecar-tool-status">
                  {m.status === "error"
                    ? <AlertCircle size={11} className="icon-error" />
                    : <Check size={11} />}
                </span>
              </summary>
              <div className="sidecar-tool-detail">
                {m.error
                  ? <span className="sidecar-tool-error-text">{m.error}</span>
                  : <span className="sidecar-tool-ok-text">Completed successfully</span>}
              </div>
            </details>
          );
        }

        if (m.role === "notification") {
          return (
            <div key={i} className="sidecar-msg notification">
              <span className="sidecar-notification-text">{m.text}</span>
              <button className="sidecar-action-btn" onClick={m.onAction}>{m.actionLabel}</button>
            </div>
          );
        }

        if (m.role === "assistant") {
          const send = (text: string) =>
            onContinueFrom ? onContinueFrom(i, text) : onSend(text);
          return (
            <div key={i} className="sidecar-msg assistant">
              <div className="sidecar-msg-header">
                <span className="sidecar-msg-role">Episteme</span>
                <div className="sidecar-msg-header-actions">
                  <CopyButton text={m.text} />
                  {onDeleteMessage && (
                    <button
                      className="sidecar-delete-btn"
                      onClick={() => onDeleteMessage(i)}
                      title="Delete message"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              </div>
              <MarkdownView content={m.text} className="sidecar-msg-markdown" onNavigate={onNavigate} />
              <div className="sidecar-msg-actions">
                <button
                  className="sidecar-action-btn primary icon-inline"
                  title="Execute the plan above using available tools"
                  onClick={() => send(EXECUTE_PROMPT)}
                >
                  Execute <ArrowRight size={12} />
                </button>
                <button
                  className="sidecar-action-btn"
                  title="Continue from this message, discarding anything after it"
                  onClick={() => send("Please continue.")}
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
              {onDeleteMessage && (
                <div className="sidecar-msg-header-actions">
                  <button
                    className="sidecar-delete-btn"
                    onClick={() => onDeleteMessage(i)}
                    title="Delete message"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              )}
            </div>
            <div className="sidecar-msg-user-text">{m.text}</div>
          </div>
        );
      })}

      {isThinking && <div className="sidecar-thinking">Thinking…</div>}
      <div ref={endRef} />
    </div>
  );
});

// ── Mention helpers ───────────────────────────────────────────────────────────

function getMentionQuery(value: string, cursor: number): string | null {
  const before = value.slice(0, cursor);
  const match = before.match(/@([\w\-./ ]*)$/);
  return match ? match[1] : null;
}

function insertMention(
  value: string,
  cursor: number,
  filename: string,
): { text: string; newCursor: number } {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const newBefore = before.replace(/@([\w\-./ ]*)$/, `@${filename} `);
  return { text: newBefore + after, newCursor: newBefore.length };
}

// ── ChatInput ─────────────────────────────────────────────────────────────────

interface ChatInputProps {
  isThinking: boolean;
  agentState: string;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  workspaceFiles?: string[];
  pendingInput?: string;
  onPendingInputConsumed?: () => void;
}

function ChatInput({ isThinking, agentState, onSend, onInterrupt, workspaceFiles = [], pendingInput, onPendingInputConsumed }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (pendingInput) {
      setInput(pendingInput + " ");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [pendingInput]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return workspaceFiles
      .filter((f) => f.toLowerCase().includes(q))
      .slice(0, 8);
  }, [mentionQuery, workspaceFiles]);

  const closeMention = useCallback(() => {
    setMentionQuery(null);
    setMentionIndex(0);
  }, []);

  const selectMention = useCallback(
    (filename: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const { text, newCursor } = insertMention(input, ta.selectionStart, filename);
      setInput(text);
      closeMention();
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(newCursor, newCursor);
      });
    },
    [input, closeMention],
  );

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInput(val);
    const cursor = e.target.selectionStart ?? val.length;
    const q = getMentionQuery(val, cursor);
    setMentionQuery(q);
    setMentionIndex(0);
  }

  function submit() {
    const text = input.trim();
    if (!text || isThinking) return;
    onSend(text);
    setInput("");
    onPendingInputConsumed?.();
    closeMention();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const chosen = mentionMatches[mentionIndex];
        if (chosen) selectMention(chosen);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
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

      {mentionMatches.length > 0 && (
        <div className="sidecar-mention-dropdown">
          {mentionMatches.map((f, i) => {
            const short = f.split("/").at(-1) ?? f;
            const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
            return (
              <button
                key={f}
                className={`sidecar-mention-item${i === mentionIndex ? " active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(f);
                }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                <span className="sidecar-mention-name">{short}</span>
                {dir && <span className="sidecar-mention-dir">{dir}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className="sidecar-input-box">
        <textarea
          ref={textareaRef}
          className="sidecar-input"
          value={input}
          placeholder="Ask or give a task… (@ to reference a file)"
          rows={2}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(closeMention, 150)}
          disabled={isThinking}
          style={{ resize: "none" }}
        />
        <div className="sidecar-input-toolbar">
          <button
            className={`sidecar-quick-toggle${showQuickActions ? " active" : ""}`}
            onClick={() => setShowQuickActions((v) => !v)}
            title="Quick action commands"
          >
            <Zap size={14} />
          </button>
          <span className={`sidecar-status${agentState === "thinking" ? " thinking" : agentState === "disconnected" ? " disconnected" : ""}`}>
            {agentState === "disconnected" ? (
              <span className="icon-inline"><Circle size={8} /> offline</span>
            ) : agentState === "thinking" ? (
              <span className="icon-inline"><CircleDashed size={8} /> thinking</span>
            ) : (
              <span className="icon-inline"><CircleDot size={8} /> ready</span>
            )}
          </span>
          {isThinking ? (
            <button
              className="sidecar-interrupt"
              onClick={onInterrupt}
              title="Stop"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              className="sidecar-send"
              onClick={submit}
              disabled={!input.trim()}
              title="Send"
            >
              <ArrowUp size={14} />
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
  agentState: string;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onClose: () => void;
  onNavigate?: (path: string) => void;
  workspaceFiles?: string[];
  onContinueFrom?: (afterIndex: number, text: string) => void;
  onDeleteMessage?: (index: number) => void;
  pendingInput?: string;
  onPendingInputConsumed?: () => void;
}

function ChatModal({ messages, isThinking, agentState, onSend, onInterrupt, onClose, onNavigate, workspaceFiles, onContinueFrom, onDeleteMessage, pendingInput, onPendingInputConsumed }: ChatModalProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-chat-expanded" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Episteme AI</span>
          <button className="modal-close" onClick={onClose} title="Close"><X size={14} /></button>
        </div>
        <div className="chat-modal-body">
          <MessageList
            messages={messages}
            isThinking={isThinking}
            onSend={onSend}
            endRef={endRef}
            onNavigate={onNavigate}
            onContinueFrom={onContinueFrom}
            onDeleteMessage={onDeleteMessage}
          />
        </div>
        <ChatInput isThinking={isThinking} agentState={agentState} onSend={onSend} onInterrupt={onInterrupt} workspaceFiles={workspaceFiles} pendingInput={pendingInput} onPendingInputConsumed={onPendingInputConsumed} />
      </div>
    </div>
  );
}

// ── AISidecar ─────────────────────────────────────────────────────────────────

export function AISidecar({
  messages,
  isThinking,
  agentState,
  collapsed,
  onSend,
  onInterrupt,
  onNavigate,
  workspaceFiles,
  onContinueFrom,
  onDeleteMessage,
  pendingInput,
  onPendingInputConsumed,
}: AISidecarProps) {
  const [expanded, setExpanded] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const { width, handleMouseDown, isDragging } = usePanelResize(300, "ai-sidecar");

  // Keep latest callbacks in refs so MessageList (which is memo'd) never re-renders
  // just because App re-renders and produces new function references.
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onContinueFromRef = useRef(onContinueFrom);
  onContinueFromRef.current = onContinueFrom;
  const onDeleteMessageRef = useRef(onDeleteMessage);
  onDeleteMessageRef.current = onDeleteMessage;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const stableSend = useCallback((text: string) => onSendRef.current(text), []);
  const stableContinueFrom = useCallback(
    (idx: number, text: string) => onContinueFromRef.current?.(idx, text),
    [],
  );
  const stableDeleteMessage = useCallback((idx: number) => onDeleteMessageRef.current?.(idx), []);
  const stableNavigate = useCallback((path: string) => onNavigateRef.current?.(path), []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  return (
    <>
      <div
        className={`ai-sidecar-track${collapsed ? " collapsed" : ""}`}
        style={collapsed ? undefined : { width, transition: isDragging ? "none" : undefined }}
      >
        <div className="ai-sidecar" style={{ width, minWidth: width }}>
          {!collapsed && <div className="panel-drag-handle" onMouseDown={handleMouseDown} />}
          <div className="sidecar-header">
            <span className="sidecar-title">Episteme AI</span>
            <button
              className="header-icon-btn"
              onClick={() => setExpanded(true)}
              title="Open full-screen chat"
            >
              <Maximize2 size={13} />
            </button>
          </div>
          <MessageList
            messages={messages}
            isThinking={isThinking}
            onSend={stableSend}
            endRef={endRef}
            onNavigate={stableNavigate}
            onContinueFrom={stableContinueFrom}
            onDeleteMessage={stableDeleteMessage}
          />
          <ChatInput isThinking={isThinking} agentState={agentState} onSend={stableSend} onInterrupt={onInterrupt} workspaceFiles={workspaceFiles} pendingInput={pendingInput} onPendingInputConsumed={onPendingInputConsumed} />
        </div>
      </div>

      {expanded && (
        <ChatModal
          messages={messages}
          isThinking={isThinking}
          agentState={agentState}
          onSend={stableSend}
          onInterrupt={onInterrupt}
          onClose={() => setExpanded(false)}
          onNavigate={stableNavigate}
          workspaceFiles={workspaceFiles}
          onContinueFrom={stableContinueFrom}
          onDeleteMessage={stableDeleteMessage}
          pendingInput={pendingInput}
          onPendingInputConsumed={onPendingInputConsumed}
        />
      )}
    </>
  );
}
