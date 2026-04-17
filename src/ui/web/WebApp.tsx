import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import type {
  ActiveTool,
  AgentState,
  ChatMessage,
  DynamicAgentRecord,
} from "../types.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BehaviorRecord {
  id: string;
  text: string;
  weight: number;
}

interface ContextualBehaviorRecord extends BehaviorRecord {
  score: number;
}

interface ConflictRecord {
  newId: string;
  newText: string;
  conflictId: string;
  conflictText: string;
  score: number;
  timestamp: number;
}

interface MemoryRow {
  id: string;
  text: string;
  timestamp: number;
  type: string;
  tags: string[];
  weight: number;
}

interface TraceEntry {
  id: string;
  score: number;
}

interface RetrievalTrace {
  timestamp: number;
  query_length: number;
  factual: TraceEntry[];
  procedure: TraceEntry[];
  recent_thoughts: Array<{ id: string }>;
}

type PanelId = "memory" | "behaviors" | "conflicts" | "agents" | "trace";

type WsMessage =
  | {
      type: "snapshot";
      messages: ChatMessage[];
      state: AgentState;
      activeTools: ActiveTool[];
      dynamicAgents: DynamicAgentRecord[];
    }
  | { type: "message"; message: ChatMessage }
  | { type: "message_updated"; message: ChatMessage }
  | { type: "state_change"; state: AgentState }
  | { type: "active_tools_changed"; tools: ActiveTool[] }
  | { type: "dynamic_agents_changed"; agents: DynamicAgentRecord[] }
  | {
      type: "permission_request";
      request: {
        agentName: string;
        toolName: string;
        args: Record<string, unknown>;
      };
    }
  | { type: "model_changed"; model: string }
  | { type: "system_prompt"; systemPrompt: string; model: string }
  | {
      type: "behavior_conflict";
      newId: string;
      newText: string;
      conflictId: string;
      conflictText: string;
      score: number;
    }
  | {
      type: "behaviors_loaded";
      core: BehaviorRecord[];
      contextual: ContextualBehaviorRecord[];
    };

interface PermissionRequest {
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_ARG_VALUE_LENGTH = 200;

function truncateArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > MAX_ARG_VALUE_LENGTH) {
      out[k] = `${v.slice(0, MAX_ARG_VALUE_LENGTH)}… [${v.length} total chars]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

const HELP_TEXT = `Available slash commands:
  /help              — show this list
  /clear             — clear the chat display
  /reasoning         — toggle reasoning/thinking display
  /model [name]      — show current model or switch to a new one
  /retry             — resend the last user message
  /copy              — copy the last response to clipboard
  /export [filename] — save the conversation to a file
  /system            — show the current system prompt
  /interrupt         — stop the agent mid-response (also available via ■ Stop button)`;

// ── Markdown renderer ─────────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  const html = marked.parse(content) as string;
  return (
    <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ThinkingBlock({
  thought,
  inProgress,
}: {
  thought: string;
  inProgress: boolean;
}) {
  const [expanded, setExpanded] = useState(inProgress);

  useEffect(() => {
    if (!inProgress) setExpanded(false);
  }, [inProgress]);

  const lineCount = thought.split("\n").length;

  return (
    <div className="thinking">
      <div className="thinking-header" onClick={() => setExpanded((x) => !x)}>
        <span
          className={`thinking-chevron ${expanded ? "thinking-chevron--open" : ""}`}
        >
          ▶
        </span>
        <span>Thinking</span>
        {!expanded && (
          <span style={{ color: "var(--text-dim)" }}>
            ({lineCount} {lineCount === 1 ? "line" : "lines"})
          </span>
        )}
      </div>
      {expanded && <div className="thinking-body">{thought}</div>}
    </div>
  );
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [content]);

  return (
    <button
      className={`copy-btn ${copied ? "copy-btn--copied" : ""}`}
      onClick={handleCopy}
      title="Copy raw markdown"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

function MessageItem({
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

function StatusArea({
  state,
  activeTools,
  dynamicAgents,
}: {
  state: AgentState;
  activeTools: ActiveTool[];
  dynamicAgents: DynamicAgentRecord[];
}) {
  const isThinking = state === "thinking";
  const activeAgents = dynamicAgents.filter((a) => a.state !== "idle");

  return (
    <div className="status">
      <div className="status-line">
        <span style={{ color: "var(--cyan)", fontWeight: "bold" }}>2b</span>
        <span
          className={`status-indicator status-indicator--${isThinking ? "thinking" : "ready"}`}
        >
          {isThinking ? (
            <>
              <span className="spinner">⟳</span>
              {activeTools.length === 0
                ? "thinking"
                : `${activeTools.length} tool${activeTools.length > 1 ? "s" : ""} running`}
            </>
          ) : (
            "ready"
          )}
        </span>
      </div>

      {isThinking && activeTools.length > 0 && (
        <div className="status-tools">
          {activeTools.map((tool, i) => (
            <div key={i} className="status-tool">
              [{tool.agentName ?? tool.name}]
              {tool.currentSubTool && (
                <>
                  {" "}
                  →{" "}
                  <span className="status-tool-sub">{tool.currentSubTool}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {activeAgents.length > 0 && (
        <div className="status-agents">
          {activeAgents.map((a) => (
            <div
              key={a.name}
              className={`status-agent ${a.state === "error" ? "status-agent--error" : ""}`}
            >
              [{a.name}] {a.state}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionDialog({
  request,
  onRespond,
}: {
  request: PermissionRequest;
  onRespond: (r: "yes" | "always" | "no") => void;
}) {
  const argsStr = JSON.stringify(truncateArgs(request.args), null, 2);

  return (
    <div className="permission-overlay">
      <div className="permission-dialog">
        <div className="permission-title">Permission Request</div>
        <div className="permission-field">
          <span className="permission-field-label">Agent: </span>
          <span className="permission-field-value">{request.agentName}</span>
        </div>
        <div className="permission-field">
          <span className="permission-field-label">Tool: </span>
          <span className="permission-field-value">{request.toolName}</span>
        </div>
        <div className="permission-field">
          <span className="permission-field-label">Args:</span>
          <pre className="permission-args">{argsStr}</pre>
        </div>
        <div className="permission-buttons">
          <button
            className="perm-btn perm-btn--yes"
            onClick={() => onRespond("yes")}
          >
            Yes once
          </button>
          <button
            className="perm-btn perm-btn--always"
            onClick={() => onRespond("always")}
          >
            Always (session)
          </button>
          <button
            className="perm-btn perm-btn--no"
            onClick={() => onRespond("no")}
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ChatInput ─────────────────────────────────────────────────────────────────

function ChatInput({
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

// ── Sidebar panels ────────────────────────────────────────────────────────────

function MemoryPanel() {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (type: string, q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (type !== "all") params.set("type", type);
      if (q.trim()) params.set("search", q.trim());
      const res = await fetch(`/api/memories?${params}`);
      const data = await res.json() as MemoryRow[];
      setMemories(data);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(typeFilter, search);
  }, [typeFilter, load]);

  const handleSearch = useCallback((q: string) => {
    setSearch(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => load(typeFilter, q), 400);
  }, [typeFilter, load]);

  const handleEdit = useCallback(async (id: string) => {
    if (!editText.trim()) return;
    await fetch(`/api/memories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editText }),
    });
    setEditingId(null);
    load(typeFilter, search);
  }, [editText, typeFilter, search, load]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this memory?")) return;
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
    setMemories(prev => prev.filter(m => m.id !== id));
    if (expandedId === id) setExpandedId(null);
  }, [expandedId]);

  return (
    <div className="panel">
      <div className="panel-controls">
        <select
          className="panel-select"
          value={typeFilter}
          onChange={e => { setTypeFilter(e.target.value); }}
        >
          <option value="all">All types</option>
          <option value="factual">Factual</option>
          <option value="behavior">Behavior</option>
          <option value="procedure">Procedure</option>
          <option value="thought">Thought</option>
        </select>
        <input
          className="panel-input"
          placeholder="Search…"
          value={search}
          onChange={e => handleSearch(e.target.value)}
        />
        <button className="panel-btn" onClick={() => load(typeFilter, search)}>↺</button>
      </div>

      {loading && <div className="panel-loading">Loading…</div>}

      <div className="panel-list">
        {memories.map(m => (
          <div key={m.id} className="memory-item">
            <div
              className="memory-header"
              onClick={() => setExpandedId(expandedId === m.id ? null : m.id)}
            >
              <span className="memory-type">{m.type}</span>
              <span className="memory-id">[{m.id.slice(0, 8)}]</span>
              <span className="memory-date">
                {new Date(m.timestamp).toLocaleDateString()}
              </span>
              {m.type === "behavior" && (
                <span className="memory-weight">w:{m.weight?.toFixed(1) ?? "?"}</span>
              )}
            </div>
            {expandedId === m.id && (
              <div className="memory-body">
                {editingId === m.id ? (
                  <>
                    <textarea
                      className="memory-edit-area"
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      rows={4}
                    />
                    <div className="memory-actions">
                      <button className="panel-btn panel-btn--green" onClick={() => handleEdit(m.id)}>Save</button>
                      <button className="panel-btn" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="memory-text">{m.text}</div>
                    {m.tags.length > 0 && (
                      <div className="memory-tags">
                        {m.tags.map(t => <span key={t} className="tag">{t}</span>)}
                      </div>
                    )}
                    <div className="memory-actions">
                      <button
                        className="panel-btn"
                        onClick={() => { setEditingId(m.id); setEditText(m.text); }}
                      >Edit</button>
                      <button
                        className="panel-btn panel-btn--red"
                        onClick={() => handleDelete(m.id)}
                      >Delete</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {!loading && memories.length === 0 && (
          <div className="panel-empty">No memories found.</div>
        )}
      </div>
    </div>
  );
}

function BehaviorsPanel({
  core,
  contextual,
}: {
  core: BehaviorRecord[];
  contextual: ContextualBehaviorRecord[];
}) {
  return (
    <div className="panel">
      {core.length === 0 && contextual.length === 0 && (
        <div className="panel-empty">No behaviors loaded yet. Send a message to trigger behavior retrieval.</div>
      )}
      {core.length > 0 && (
        <>
          <div className="panel-section-label">Always active ({core.length})</div>
          {core.map(b => (
            <div key={b.id} className="behavior-item behavior-item--core">
              <div className="behavior-meta">
                <span className="memory-id">[{b.id.slice(0, 8)}]</span>
                <span className="memory-weight">w:{b.weight.toFixed(1)}</span>
              </div>
              <div className="behavior-text">{b.text}</div>
            </div>
          ))}
        </>
      )}
      {contextual.length > 0 && (
        <>
          <div className="panel-section-label">This turn ({contextual.length})</div>
          {contextual.map(b => (
            <div key={b.id} className="behavior-item">
              <div className="behavior-meta">
                <span className="memory-id">[{b.id.slice(0, 8)}]</span>
                <span className="memory-weight">w:{b.weight.toFixed(1)}</span>
                <span className="behavior-score">sim:{b.score.toFixed(2)}</span>
              </div>
              <div className="behavior-text">{b.text}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function ConflictsPanel({
  conflicts,
  onDismiss,
  onSynthesize,
}: {
  conflicts: ConflictRecord[];
  onDismiss: (c: ConflictRecord) => void;
  onSynthesize: (c: ConflictRecord) => Promise<void>;
}) {
  const [synthesizing, setSynthesizing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const handleSynthesize = async (c: ConflictRecord) => {
    const key = `${c.newId}::${c.conflictId}`;
    setSynthesizing(key);
    try {
      const res = await fetch("/api/behaviors/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_a: c.newId, id_b: c.conflictId }),
      });
      const data = await res.json() as { result?: string; error?: string };
      setResults(prev => ({ ...prev, [key]: data.result ?? data.error ?? "Done." }));
      await onSynthesize(c);
    } catch (e) {
      setResults(prev => ({ ...prev, [key]: String(e) }));
    } finally {
      setSynthesizing(null);
    }
  };

  if (conflicts.length === 0) {
    return (
      <div className="panel">
        <div className="panel-empty">No pending conflicts.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      {conflicts.map(c => {
        const key = `${c.newId}::${c.conflictId}`;
        const isBusy = synthesizing === key;
        const result = results[key];
        return (
          <div key={key} className="conflict-item">
            <div className="conflict-score">
              Similarity: {(c.score * 100).toFixed(0)}%
            </div>
            <div className="conflict-pair">
              <div className="conflict-behavior">
                <span className="conflict-label">New</span>
                <span className="memory-id">[{c.newId.slice(0, 8)}]</span>
                <div className="conflict-text">{c.newText}</div>
              </div>
              <div className="conflict-behavior">
                <span className="conflict-label">Conflicts with</span>
                <span className="memory-id">[{c.conflictId.slice(0, 8)}]</span>
                <div className="conflict-text">{c.conflictText}</div>
              </div>
            </div>
            {result && (
              <div className="conflict-result">{result}</div>
            )}
            {!result && (
              <div className="conflict-actions">
                <button
                  className="panel-btn panel-btn--green"
                  onClick={() => handleSynthesize(c)}
                  disabled={isBusy}
                >
                  {isBusy ? "Synthesizing…" : "Synthesize"}
                </button>
                <button
                  className="panel-btn"
                  onClick={() => onDismiss(c)}
                  disabled={isBusy}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AgentsPanel({ agents }: { agents: DynamicAgentRecord[] }) {
  if (agents.length === 0) {
    return (
      <div className="panel">
        <div className="panel-empty">No dynamic agents spawned yet.</div>
      </div>
    );
  }
  return (
    <div className="panel">
      {agents.map(a => (
        <div key={a.name} className="agent-item">
          <div className="agent-header">
            <span className="agent-name">{a.name}</span>
            <span className={`agent-state agent-state--${a.state}`}>{a.state}</span>
          </div>
          <div className="agent-meta">
            <span className="agent-type">{(a as any).type ?? "headless"}</span>
            {a.createdAt && (
              <span className="agent-date">
                {new Date(a.createdAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          {(a as any).capabilities && (
            <div className="memory-tags">
              {((a as any).capabilities as string[]).map((cap: string) => (
                <span key={cap} className="tag">{cap}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function TracePanel() {
  const [trace, setTrace] = useState<RetrievalTrace | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trace/last");
      const data = await res.json() as RetrievalTrace | null;
      setTrace(data);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="panel">
      <div className="panel-controls">
        <button className="panel-btn" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "↺ Refresh trace"}
        </button>
      </div>
      {!trace && !loading && (
        <div className="panel-empty">Click refresh to load the last retrieval trace.</div>
      )}
      {trace && (
        <>
          <div className="panel-section-label">
            Query length: {trace.query_length} chars
          </div>
          {trace.factual.length > 0 && (
            <>
              <div className="panel-section-label">Factual memories ({trace.factual.length})</div>
              {trace.factual.map(f => (
                <div key={f.id} className="trace-item">
                  <span className="memory-id">[{f.id.slice(0, 8)}]</span>
                  <span className="behavior-score">sim:{f.score.toFixed(3)}</span>
                </div>
              ))}
            </>
          )}
          {trace.procedure.length > 0 && (
            <>
              <div className="panel-section-label">Procedures ({trace.procedure.length})</div>
              {trace.procedure.map(p => (
                <div key={p.id} className="trace-item">
                  <span className="memory-id">[{p.id.slice(0, 8)}]</span>
                  <span className="behavior-score">sim:{p.score.toFixed(3)}</span>
                </div>
              ))}
            </>
          )}
          {trace.recent_thoughts.length > 0 && (
            <>
              <div className="panel-section-label">Recent thoughts ({trace.recent_thoughts.length})</div>
              {trace.recent_thoughts.map(t => (
                <div key={t.id} className="trace-item">
                  <span className="memory-id">[{t.id.slice(0, 8)}]</span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({
  panels,
  conflicts,
  coreBehaviors,
  contextualBehaviors,
  dynamicAgents,
  onDismissConflict,
  onSynthesize,
}: {
  panels: PanelId[];
  conflicts: ConflictRecord[];
  coreBehaviors: BehaviorRecord[];
  contextualBehaviors: ContextualBehaviorRecord[];
  dynamicAgents: DynamicAgentRecord[];
  onDismissConflict: (c: ConflictRecord) => void;
  onSynthesize: (c: ConflictRecord) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<PanelId>(panels[0] ?? "memory");

  // Make sure activeTab stays valid if panels change
  useEffect(() => {
    if (!panels.includes(activeTab) && panels.length > 0) {
      setActiveTab(panels[0]!);
    }
  }, [panels, activeTab]);

  const tabLabels: Record<PanelId, string> = {
    memory: "Memory",
    behaviors: "Behaviors",
    conflicts: "Conflicts",
    agents: "Agents",
    trace: "Trace",
  };

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        {panels.map(p => (
          <button
            key={p}
            className={`sidebar-tab ${activeTab === p ? "sidebar-tab--active" : ""}`}
            onClick={() => setActiveTab(p)}
          >
            {tabLabels[p]}
            {p === "conflicts" && conflicts.length > 0 && (
              <span className="tab-badge">{conflicts.length}</span>
            )}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {activeTab === "memory" && <MemoryPanel />}
        {activeTab === "behaviors" && (
          <BehaviorsPanel core={coreBehaviors} contextual={contextualBehaviors} />
        )}
        {activeTab === "conflicts" && (
          <ConflictsPanel
            conflicts={conflicts}
            onDismiss={onDismissConflict}
            onSynthesize={onSynthesize}
          />
        )}
        {activeTab === "agents" && <AgentsPanel agents={dynamicAgents} />}
        {activeTab === "trace" && <TracePanel />}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<AgentState>("idle");
  const [activeTools, setActiveTools] = useState<ActiveTool[]>([]);
  const [dynamicAgents, setDynamicAgents] = useState<DynamicAgentRecord[]>([]);
  const [pendingPermission, setPendingPermission] =
    useState<PermissionRequest | null>(null);
  const [showReasoning, setShowReasoning] = useState(true);
  const [currentModel, setCurrentModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [connected, setConnected] = useState(false);

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    return localStorage.getItem("sidebarOpen") === "true";
  });
  const [availablePanels, setAvailablePanels] = useState<PanelId[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [coreBehaviors, setCoreBehaviors] = useState<BehaviorRecord[]>([]);
  const [contextualBehaviors, setContextualBehaviors] = useState<ContextualBehaviorRecord[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const upsertMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx === -1) return [...prev, msg];
      const next = [...prev];
      next[idx] = msg;
      return next;
    });
  }, []);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem("sidebarOpen", sidebarOpen ? "true" : "false");
  }, [sidebarOpen]);

  // Fetch capabilities on connect
  const fetchCapabilities = useCallback(async () => {
    try {
      const res = await fetch("/api/capabilities");
      const data = await res.json() as { panels: PanelId[] };
      setAvailablePanels(data.panels);
    } catch {
      // non-critical
    }
  }, []);

  // Fetch existing conflicts on connect
  const fetchConflicts = useCallback(async () => {
    try {
      const res = await fetch("/api/behaviors/conflicts");
      if (res.ok) {
        const data = await res.json() as ConflictRecord[];
        setConflicts(data);
      }
    } catch {
      // non-critical
    }
  }, []);

  // WebSocket connection
  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onclose = () => setConnected(false);

    ws.onmessage = (ev) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(ev.data as string) as WsMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "snapshot":
          setMessages(msg.messages as ChatMessage[]);
          setState(msg.state);
          setActiveTools(msg.activeTools);
          setDynamicAgents(msg.dynamicAgents);
          break;
        case "message":
          upsertMessage(msg.message);
          break;
        case "message_updated":
          upsertMessage(msg.message);
          break;
        case "state_change":
          setState(msg.state);
          break;
        case "active_tools_changed":
          setActiveTools(msg.tools);
          break;
        case "dynamic_agents_changed":
          setDynamicAgents(msg.agents);
          break;
        case "permission_request":
          setPendingPermission(msg.request);
          break;
        case "model_changed":
          setCurrentModel(msg.model);
          break;
        case "system_prompt":
          setSystemPrompt(msg.systemPrompt);
          setCurrentModel(msg.model);
          break;
        case "behavior_conflict":
          setConflicts(prev => {
            const key = [msg.newId, msg.conflictId].sort().join("::");
            const exists = prev.some(c =>
              [c.newId, c.conflictId].sort().join("::") === key
            );
            if (exists) return prev;
            return [...prev, {
              newId: msg.newId,
              newText: msg.newText,
              conflictId: msg.conflictId,
              conflictText: msg.conflictText,
              score: msg.score,
              timestamp: Date.now(),
            }];
          });
          break;
        case "behaviors_loaded":
          setCoreBehaviors(msg.core);
          setContextualBehaviors(msg.contextual);
          break;
      }
    };

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "system_prompt_request" }));
      fetchCapabilities();
      fetchConflicts();
    };

    return () => ws.close();
  }, [upsertMessage, fetchCapabilities, fetchConflicts]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendToWs = useCallback((msg: unknown) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  // ── Slash command handler ────────────────────────────────────────────────────

  const handleSlash = useCallback(
    (input: string): boolean => {
      if (!input.startsWith("/")) return false;
      const parts = input.slice(1).trim().split(/\s+/);
      const command = parts[0]?.toLowerCase() ?? "";
      const args = parts.slice(1);

      const addSys = (content: string) => {
        const msg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "system",
          content,
          toolCalls: [],
          status: "complete",
          timestamp: new Date().toISOString() as unknown as Date,
        };
        setMessages((prev) => [...prev, msg]);
      };

      switch (command) {
        case "help":
        case "?":
          addSys(HELP_TEXT);
          return true;
        case "clear":
          setMessages([]);
          sendToWs({ type: "clear" });
          return true;
        case "reasoning":
          setShowReasoning((v) => {
            addSys(`Reasoning display: ${!v ? "on" : "off"}`);
            return !v;
          });
          return true;
        case "model": {
          const name = args[0];
          if (!name) {
            addSys(`Current model: ${currentModel}\nUsage: /model <name>`);
          } else {
            sendToWs({ type: "model_change", model: name });
            setCurrentModel(name);
            addSys(`Switched to model: ${name}`);
          }
          return true;
        }
        case "retry": {
          const lastUser = [...messages]
            .reverse()
            .find((m) => m.role === "user");
          if (!lastUser) {
            addSys("No previous message to retry.");
            return true;
          }
          sendToWs({ type: "send", text: lastUser.content });
          return true;
        }
        case "copy": {
          const lastAsst = [...messages]
            .reverse()
            .find(
              (m) =>
                m.role === "assistant" &&
                m.status === "complete" &&
                m.content.length > 0,
            );
          if (!lastAsst) {
            addSys("No response to copy.");
            return true;
          }
          navigator.clipboard.writeText(lastAsst.content).then(
            () => addSys("Copied to clipboard."),
            () => addSys("Failed to copy — clipboard permission denied."),
          );
          return true;
        }
        case "export": {
          const filename =
            args[0] ??
            `2b-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.txt`;
          const lines: string[] = [];
          for (const msg of messages) {
            if (msg.role === "system") continue;
            lines.push(
              `${msg.role === "user" ? "You" : "2b"}:\n${msg.content}`,
            );
          }
          const blob = new Blob([lines.join("\n\n") + "\n"], {
            type: "text/plain",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          addSys(`Conversation saved as ${filename}`);
          return true;
        }
        case "system":
          addSys(`System prompt:\n\n${systemPrompt}`);
          return true;
        default:
          addSys(
            `Unknown command: /${command}\nType /help for available commands.`,
          );
          return true;
      }
    },
    [messages, currentModel, systemPrompt, sendToWs],
  );

  const handleSubmit = useCallback(
    (text: string) => {
      if (!handleSlash(text)) {
        sendToWs({ type: "send", text });
      }
    },
    [handleSlash, sendToWs],
  );

  const handlePermission = useCallback(
    (response: "yes" | "always" | "no") => {
      setPendingPermission(null);
      sendToWs({ type: "permission_response", response });
    },
    [sendToWs],
  );

  const handleDismissConflict = useCallback((c: ConflictRecord) => {
    setConflicts(prev =>
      prev.filter(x => !(x.newId === c.newId && x.conflictId === c.conflictId))
    );
  }, []);

  const handleSynthesize = useCallback(async (c: ConflictRecord) => {
    // Remove conflict after synthesis completes
    setConflicts(prev =>
      prev.filter(x => !(x.newId === c.newId && x.conflictId === c.conflictId))
    );
  }, []);

  const isBlocked = state === "thinking" || !!pendingPermission;
  const showSidebar = sidebarOpen && availablePanels.length > 0;

  return (
    <div className={`app-shell ${showSidebar ? "app-shell--sidebar-open" : ""}`}>
      {/* Chat column */}
      <div className="app">
        <header className="header">
          <span className="header-title">2b</span>
          <div className="header-right">
            <span className="header-model">
              {connected ? currentModel || "connected" : "connecting…"}
            </span>
            {availablePanels.length > 0 && (
              <button
                className="sidebar-toggle"
                onClick={() => setSidebarOpen(v => !v)}
                title={sidebarOpen ? "Close panel" : "Open panel"}
              >
                {sidebarOpen ? "⊠" : "⊞"}
                {!sidebarOpen && conflicts.length > 0 && (
                  <span className="tab-badge">{conflicts.length}</span>
                )}
              </button>
            )}
          </div>
        </header>

        <div className="messages">
          {messages.map((msg) => (
            <MessageItem
              key={msg.id}
              message={msg}
              showReasoning={showReasoning}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <StatusArea
          state={state}
          activeTools={activeTools}
          dynamicAgents={dynamicAgents}
        />

        {state === "thinking" && (
          <div className="stop-area">
            <button
              className="stop-btn"
              onClick={() => sendToWs({ type: "interrupt", scope: "all" })}
            >
              ■ Stop
            </button>
          </div>
        )}

        <ChatInput
          isBlocked={isBlocked}
          agentState={state}
          onSubmit={handleSubmit}
        />
      </div>

      {/* Sidebar */}
      {showSidebar && (
        <Sidebar
          panels={availablePanels}
          conflicts={conflicts}
          coreBehaviors={coreBehaviors}
          contextualBehaviors={contextualBehaviors}
          dynamicAgents={dynamicAgents}
          onDismissConflict={handleDismissConflict}
          onSynthesize={handleSynthesize}
        />
      )}

      {pendingPermission && (
        <PermissionDialog
          request={pendingPermission}
          onRespond={handlePermission}
        />
      )}
    </div>
  );
}

// ── Mount ─────────────────────────────────────────────────────────────────────

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
