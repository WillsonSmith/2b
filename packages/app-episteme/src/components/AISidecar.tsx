import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import { Check, CheckCircle2, CornerDownRight, Loader2, ArrowUp, Zap, Maximize2, X, Square, Circle, CircleDashed, CircleDot, Trash2, AlertCircle, Search, List, PenLine, Pencil, Quote, BarChart2, FolderOpen, ClipboardList, MoreHorizontal, Layers, GitBranch } from "lucide-react";
import { MarkdownView } from "./MarkdownView.tsx";
import { PlanModeOptions } from "./PlanModeOptions.tsx";
import { usePanelResize } from "../hooks/usePanelResize.ts";
import type { EpistemePlanStepType } from "../planning/types.ts";
import { useAI } from "../state/AIContext.tsx";
import { useSignalValue } from "../state/signals.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SidecarMessage =
  | { role: "user"; text: string; id?: number }
  | { role: "assistant"; text: string; id?: number }
  | { role: "tool"; name: string; status: "calling" | "done" | "error"; error?: string }
  | { role: "notification"; text: string; actionLabel: string; onAction: () => void }
  | { role: "system_event"; text: string; plugin?: string }
  | {
      role: "plan_step";
      planId: string;
      stepId: string;
      stepTitle: string;
      stepType: EpistemePlanStepType;
      state: "running" | "complete" | "failed";
      summary?: string;
      error?: string;
    };

interface AISidecarProps {
  /** Files for the @-mention dropdown. Will move to FileContext in Phase 3. */
  workspaceFiles?: string[];
  /** Active file for plan-mode "use document" option. Phase 3 → FileContext. */
  activeFile?: string | null;
  /** Open a file by path (for navigating mention links). Phase 3 → FileContext. */
  onNavigate?: (path: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

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

// ── Plan step icons (compact, local copy — kept independent from PlanPanel.tsx)

const PLAN_STEP_TYPE_ICONS: Record<EpistemePlanStepType, React.FC<{ size?: number; className?: string }>> = {
  research: ({ size = 11, className }) => <Search size={size} className={className} />,
  outline:  ({ size = 11, className }) => <List size={size} className={className} />,
  draft:    ({ size = 11, className }) => <PenLine size={size} className={className} />,
  edit:     ({ size = 11, className }) => <Pencil size={size} className={className} />,
  cite:     ({ size = 11, className }) => <Quote size={size} className={className} />,
  analyze:  ({ size = 11, className }) => <BarChart2 size={size} className={className} />,
  organize: ({ size = 11, className }) => <FolderOpen size={size} className={className} />,
};

// ── AssistantMessage ──────────────────────────────────────────────────────────

interface AssistantMessageProps {
  message: Extract<SidecarMessage, { role: "assistant" }>;
  index: number;
  onNavigate?: (path: string) => void;
}

function AssistantMessage({ message, index, onNavigate }: AssistantMessageProps) {
  const ai = useAI();
  const activePlan = useSignalValue(ai.activePlan);
  const [menuOpen, setMenuOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpGoal, setFollowUpGoal] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const submitFollowUp = () => {
    const goal = followUpGoal.trim();
    if (!goal) return;
    if (activePlan) {
      ai.planFollowUp(goal, activePlan.id, "per_step");
    } else {
      ai.planRequest(goal, "per_step");
    }
    setFollowUpGoal("");
    setFollowUpOpen(false);
  };

  const cancelFollowUp = () => {
    setFollowUpGoal("");
    setFollowUpOpen(false);
  };

  return (
    <div className="sidecar-msg assistant">
      <div className="sidecar-msg-header">
        <span className="sidecar-msg-role">Episteme</span>
        <div className="sidecar-msg-header-actions">
          <div className="sidecar-msg-menu" ref={menuRef}>
            <button
              className="sidecar-menu-trigger"
              onClick={() => setMenuOpen(v => !v)}
              title="Actions"
            >
              <MoreHorizontal size={12} />
            </button>
            {menuOpen && (
              <div className="sidecar-msg-dropdown">
                <button
                  className="sidecar-dropdown-item"
                  onClick={() => { setMenuOpen(false); ai.regenerate(index); }}
                >
                  Regenerate
                </button>
                <button
                  className="sidecar-dropdown-item"
                  onClick={() => {
                    setMenuOpen(false);
                    navigator.clipboard.writeText(message.text).catch(() => {});
                  }}
                >
                  Copy
                </button>
                <button
                  className="sidecar-dropdown-item"
                  onClick={() => { setMenuOpen(false); ai.sendToPlan(message.text); }}
                >
                  Send to Plan
                </button>
                <button
                  className="sidecar-dropdown-item"
                  onClick={() => { setMenuOpen(false); setFollowUpOpen(true); }}
                >
                  Follow up plan…
                </button>
              </div>
            )}
          </div>
          <button
            className="sidecar-delete-btn"
            onClick={() => ai.deleteMessage(index)}
            title="Delete message"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
      <MarkdownView content={message.text} className="sidecar-msg-markdown" onNavigate={onNavigate} />
      {followUpOpen && (
        <div className="sidecar-followup-composer">
          {activePlan ? (
            <div className="sidecar-followup-context">
              Following up: <em>{activePlan.goal}</em>
            </div>
          ) : (
            <div className="sidecar-followup-warn">
              No prior plan — this will start a fresh plan.
            </div>
          )}
          <textarea
            className="sidecar-followup-input"
            placeholder="What do you want to do next?"
            value={followUpGoal}
            rows={2}
            autoFocus
            onChange={(e) => setFollowUpGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitFollowUp();
              if (e.key === "Escape") cancelFollowUp();
            }}
          />
          <div className="sidecar-followup-actions">
            <button
              className="sidecar-followup-submit"
              onClick={submitFollowUp}
              disabled={!followUpGoal.trim()}
            >
              {activePlan ? "Create follow-up" : "Create plan"}
            </button>
            <button className="sidecar-followup-cancel" onClick={cancelFollowUp}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── FileMentionChip ───────────────────────────────────────────────────────────

interface FileMentionChipProps {
  path: string;
  onRemove?: () => void;
}

function FileMentionChip({ path, onRemove }: FileMentionChipProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const short = path.split("/").at(-1) ?? path;

  function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || content !== null || loading) return;
    setLoading(true);
    fetch(`/api/file-content?path=${encodeURIComponent(path)}`)
      .then((r) => r.json() as Promise<{ content?: string }>)
      .then((d) => {
        if (d.content != null) setContent(d.content);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  return (
    <details className="sidecar-mention-chip" onToggle={handleToggle}>
      <summary className="sidecar-mention-chip-summary">
        <span className="sidecar-mention-chip-name">@{short}</span>
        {onRemove && (
          <button
            className="sidecar-mention-chip-remove"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
            title="Remove reference"
          >
            <X size={9} />
          </button>
        )}
      </summary>
      <div className="sidecar-mention-chip-content">
        {loading && <span className="sidecar-mention-chip-loading">Loading…</span>}
        {error && <span className="sidecar-mention-chip-error">Could not load file.</span>}
        {content !== null && <pre className="sidecar-mention-chip-pre">{content}</pre>}
      </div>
    </details>
  );
}

// ── MessageList ───────────────────────────────────────────────────────────────

interface MessageListProps {
  endRef: React.MutableRefObject<HTMLDivElement | null>;
  onNavigate?: (path: string) => void;
}

const MessageList = memo(function MessageList({ endRef, onNavigate }: MessageListProps) {
  const ai = useAI();
  const messages = useSignalValue(ai.messages);
  const agentState = useSignalValue(ai.agentState);
  const isThinking = agentState === "thinking";

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

        if (m.role === "system_event") {
          return (
            <div key={i} className="sidecar-system-event">
              <span className="sidecar-system-event-icon"><Layers size={11} /></span>
              <span className="sidecar-system-event-text">{m.text}</span>
            </div>
          );
        }

        if (m.role === "plan_step") {
          const TypeIcon = PLAN_STEP_TYPE_ICONS[m.stepType];
          const stateIcon = () => {
            switch (m.state) {
              case "running":  return <Loader2 size={11} className="icon-spin" />;
              case "complete": return <CheckCircle2 size={11} className="sidecar-plan-step-done" />;
              case "failed":   return <AlertCircle size={11} className="sidecar-plan-step-fail" />;
            }
          };

          const isExpandable = !!(m.summary || m.error);

          return isExpandable ? (
            <details key={i} className={`sidecar-plan-step sidecar-plan-step--${m.state}`}>
              <summary className="sidecar-plan-step-summary">
                <span className="sidecar-plan-step-state">{stateIcon()}</span>
                <span className="sidecar-plan-step-type-icon"><TypeIcon /></span>
                <span className="sidecar-plan-step-title">{m.stepTitle}</span>
                <span className="sidecar-plan-step-type">{m.stepType}</span>
              </summary>
              <div className="sidecar-plan-step-detail">
                {m.error
                  ? <span className="sidecar-plan-step-error">{m.error}</span>
                  : <span className="sidecar-plan-step-result">{m.summary}</span>}
              </div>
            </details>
          ) : (
            <div key={i} className={`sidecar-plan-step sidecar-plan-step--${m.state}`}>
              <span className="sidecar-plan-step-state">{stateIcon()}</span>
              <span className="sidecar-plan-step-type-icon"><TypeIcon /></span>
              <span className="sidecar-plan-step-title">{m.stepTitle}</span>
              <span className="sidecar-plan-step-type">{m.stepType}</span>
            </div>
          );
        }

        if (m.role === "assistant") {
          return (
            <AssistantMessage
              key={i}
              message={m}
              index={i}
              onNavigate={onNavigate}
            />
          );
        }

        const mentions = extractMentions(m.text);
        return (
          <div key={i} className="sidecar-msg user">
            <div className="sidecar-msg-header">
              <span className="sidecar-msg-role">You</span>
              <div className="sidecar-msg-header-actions">
                <button
                  className="sidecar-delete-btn"
                  onClick={() => ai.deleteMessage(i)}
                  title="Delete message"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
            <div className="sidecar-msg-user-text">{m.text}</div>
            {mentions.length > 0 && (
              <div className="sidecar-mention-footer">
                {mentions.map((p) => (
                  <FileMentionChip
                    key={p}
                    path={p}
                    onRemove={() => ai.removeMention(i, p)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {isThinking && <div className="sidecar-thinking">Thinking…</div>}
      <div ref={endRef} />
    </div>
  );
});

// ── Mention helpers ───────────────────────────────────────────────────────────

function extractMentions(text: string): string[] {
  return [...text.matchAll(/@([\w\-./ ]+\.md)/g)].map((m) => m[1]!.trim());
}

function getMentionQuery(value: string, cursor: number): string | null {
  const before = value.slice(0, cursor);
  const match = before.match(/@([\w\-./ ]*)$/);
  return match ? match[1] ?? null : null;
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
  workspaceFiles: string[];
  activeFile?: string | null;
}

function ChatInput({ workspaceFiles, activeFile }: ChatInputProps) {
  const ai = useAI();
  const agentState = useSignalValue(ai.agentState);
  const providerStatus = useSignalValue(ai.providerStatus);
  const providerReachable = providerStatus?.reachable ?? null;
  const pendingInput = useSignalValue(ai.sidecarPendingInput);
  const activePlan = useSignalValue(ai.activePlan);
  const isThinking = agentState === "thinking";

  const [input, setInput] = useState("");
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [planMode, setPlanMode] = useState(false);
  const [followUpMode, setFollowUpMode] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"all" | "per_step">("per_step");
  const [useDocument, setUseDocument] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-disable follow-up mode if the active plan disappears
  useEffect(() => {
    if (!activePlan && followUpMode) setFollowUpMode(false);
  }, [activePlan, followUpMode]);

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

    if (followUpMode && activePlan) {
      ai.planFollowUp(text, activePlan.id, approvalMode);
      setInput("");
      setFollowUpMode(false);
      ai.sidecarPendingInput.value = "";
      closeMention();
      return;
    }

    if (planMode) {
      if (useDocument && activeFile) {
        ai.planRequestFromDocument(activeFile, text, approvalMode);
      } else {
        ai.planRequest(text, approvalMode);
      }
      setInput("");
      setPlanMode(false);
      setUseDocument(false);
      ai.sidecarPendingInput.value = "";
      closeMention();
      return;
    }

    ai.sendToAgent(text);
    setInput("");
    ai.sidecarPendingInput.value = "";
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

      {followUpMode && activePlan && (
        <div className="sidecar-followup-badge">
          <GitBranch size={11} />
          <span>Following up: <em>{activePlan.goal}</em></span>
          <button
            type="button"
            className="sidecar-followup-clear"
            onClick={() => setFollowUpMode(false)}
            title="Cancel follow-up"
          >
            <X size={10} />
          </button>
        </div>
      )}

      {(planMode || followUpMode) && (
        <PlanModeOptions
          approvalMode={approvalMode}
          onApprovalModeChange={setApprovalMode}
          useDocument={useDocument}
          onUseDocumentChange={setUseDocument}
          activeFile={activeFile}
          radioGroupName="sidecar-approval"
          wrapperClassName="sidecar-plan-mode-options"
          labelClassName="sidecar-plan-mode-label"
          withSpans={false}
        />
      )}

      <div className="sidecar-input-box">
        <textarea
          ref={textareaRef}
          className="sidecar-input"
          value={input}
          placeholder={
            followUpMode
              ? "What do you want to do next? (@ to reference files)"
              : planMode
                ? "Describe what you want to accomplish… (@ to reference files)"
                : "Ask or give a task… (@ to reference a file)"
          }
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
          <button
            className={`sidecar-quick-toggle${planMode ? " active" : ""}`}
            onClick={() => { setPlanMode((v) => !v); if (followUpMode) setFollowUpMode(false); }}
            title={planMode ? "Exit planning mode" : "Create a plan"}
            disabled={isThinking}
          >
            <ClipboardList size={14} />
          </button>
          <button
            className={`sidecar-quick-toggle${followUpMode ? " active" : ""}`}
            onClick={() => { setFollowUpMode((v) => !v); if (planMode) setPlanMode(false); }}
            title={
              !activePlan
                ? "Follow up plan — disabled (no active plan)"
                : followUpMode
                  ? "Exit follow-up mode"
                  : `Follow up active plan: ${activePlan.goal}`
            }
            disabled={isThinking || !activePlan}
          >
            <GitBranch size={14} />
          </button>
          <span
            className={`sidecar-status${
              agentState === "thinking"
                ? " thinking"
                : agentState === "disconnected" || providerReachable === false
                  ? " disconnected"
                  : ""
            }`}
            title={
              agentState === "disconnected"
                ? "WebSocket disconnected"
                : providerReachable === false
                  ? "Ollama backend is not responding"
                  : undefined
            }
          >
            {agentState === "disconnected" ? (
              <span className="icon-inline"><Circle size={8} /> offline</span>
            ) : providerReachable === false ? (
              <span className="icon-inline"><Circle size={8} /> Ollama offline</span>
            ) : agentState === "thinking" ? (
              <span className="icon-inline"><CircleDashed size={8} /> thinking</span>
            ) : (
              <span className="icon-inline"><CircleDot size={8} /> ready</span>
            )}
          </span>
          {isThinking ? (
            <button
              className="sidecar-interrupt"
              onClick={() => ai.interrupt()}
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
  workspaceFiles: string[];
  activeFile?: string | null;
  onNavigate?: (path: string) => void;
  onClose: () => void;
}

function ChatModal({ workspaceFiles, activeFile, onNavigate, onClose }: ChatModalProps) {
  const ai = useAI();
  const messages = useSignalValue(ai.messages);
  const agentState = useSignalValue(ai.agentState);
  const isThinking = agentState === "thinking";
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
          <MessageList endRef={endRef} onNavigate={onNavigate} />
        </div>
        <ChatInput workspaceFiles={workspaceFiles} activeFile={activeFile} />
      </div>
    </div>
  );
}

// ── AISidecar ─────────────────────────────────────────────────────────────────

export function AISidecar({ workspaceFiles = [], activeFile, onNavigate }: AISidecarProps) {
  const ai = useAI();
  const collapsed = useSignalValue(ai.sidecarCollapsed);
  const messages = useSignalValue(ai.messages);
  const agentState = useSignalValue(ai.agentState);
  const isThinking = agentState === "thinking";

  const [expanded, setExpanded] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const { width, handleMouseDown, isDragging } = usePanelResize(300, "ai-sidecar");

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
          <MessageList endRef={endRef} onNavigate={onNavigate} />
          <ChatInput workspaceFiles={workspaceFiles} activeFile={activeFile} />
        </div>
      </div>

      {expanded && (
        <ChatModal
          workspaceFiles={workspaceFiles}
          activeFile={activeFile}
          onNavigate={onNavigate}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  );
}
