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
  | { type: "system_prompt"; systemPrompt: string; model: string };

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
  /system            — show the current system prompt`;

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
  model,
}: {
  state: AgentState;
  activeTools: ActiveTool[];
  dynamicAgents: DynamicAgentRecord[];
  model: string;
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
        {model && (
          <span className="header-model" style={{ marginLeft: "auto" }}>
            {model}
          </span>
        )}
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

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Update a single message in state
  const upsertMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx === -1) return [...prev, msg];
      const next = [...prev];
      next[idx] = msg;
      return next;
    });
  }, []);

  // WebSocket connection
  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
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
      }
    };

    // Request system prompt on connect
    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "system_prompt_request" }));
    };

    return () => ws.close();
  }, [upsertMessage]);

  // Auto-scroll when messages change
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

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    (text: string) => {
      if (!handleSlash(text)) {
        sendToWs({ type: "send", text });
      }
    },
    [handleSlash, sendToWs],
  );

  // ── Permission response ──────────────────────────────────────────────────────

  const handlePermission = useCallback(
    (response: "yes" | "always" | "no") => {
      setPendingPermission(null);
      sendToWs({ type: "permission_response", response });
    },
    [sendToWs],
  );

  const isBlocked = state === "thinking" || !!pendingPermission;

  return (
    <div className="app">
      <header className="header">
        <span className="header-title">2b</span>
        <span className="header-model">
          {connected ? currentModel || "connected" : "connecting…"}
        </span>
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
        model=""
      />

      <ChatInput
        isBlocked={isBlocked}
        agentState={state}
        onSubmit={handleSubmit}
      />

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
