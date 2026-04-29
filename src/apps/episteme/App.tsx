import { createRoot } from "react-dom/client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Editor } from "./components/Editor.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { AISidecar, type SidecarMessage } from "./components/AISidecar.tsx";
import "./styles.css";

// ── WebSocket protocol ────────────────────────────────────────────────────────

type ServerMsg =
  | { type: "speak"; text: string }
  | { type: "state_change"; state: "idle" | "thinking" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string }
  | { type: "file_content"; path: string; content: string }
  | { type: "workspace_files"; files: string[] }
  | { type: "file_saved" }
  | { type: "error"; message: string };

// ── Debounce ──────────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [agentState, setAgentState] = useState<"idle" | "thinking" | "disconnected">("disconnected");
  const [messages, setMessages] = useState<SidecarMessage[]>([]);
  const [sidecarCollapsed, setSidecarCollapsed] = useState(false);

  // Editor state
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // Workspace
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceName, setWorkspaceName] = useState("workspace");

  const wsRef = useRef<WebSocket | null>(null);
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;

  const debouncedContent = useDebounce(editorContent, 500);

  // ── WebSocket setup ──────────────────────────────────────────────────────────

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(`ws://${location.host}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setAgentState("idle");
        // Request workspace file list on connect
        ws.send(JSON.stringify({ type: "list_workspace" }));
        // Fetch config for workspace name
        fetch("/api/health")
          .then((r) => r.json())
          .then((data: { workspace?: string }) => {
            if (data.workspace) {
              const parts = data.workspace.split("/");
              setWorkspaceName(parts.at(-1) ?? data.workspace);
            }
          })
          .catch(() => {});
      };

      ws.onclose = () => {
        setAgentState("disconnected");
        wsRef.current = null;
        setTimeout(connect, 2000); // reconnect
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMsg;
        switch (msg.type) {
          case "state_change":
            setAgentState(msg.state);
            break;
          case "speak":
            setMessages((prev) => [...prev, { role: "assistant", text: msg.text }]);
            break;
          case "workspace_files":
            setWorkspaceFiles(msg.files);
            break;
          case "file_content":
            setEditorContent(msg.content);
            setSavedContent(msg.content);
            setIsDirty(false);
            break;
          case "file_saved":
            setSavedContent(editorContentRef.current);
            setIsDirty(false);
            break;
          case "error":
            setMessages((prev) => [
              ...prev,
              { role: "assistant", text: `[Error] ${msg.message}` },
            ]);
            break;
        }
      };
    }

    connect();
    return () => wsRef.current?.close();
  }, []);

  // ── Sync editor content to agent context (debounced) ─────────────────────────

  useEffect(() => {
    if (!activeFile || !wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(
      JSON.stringify({
        type: "editor_context",
        file: activeFile,
        content: debouncedContent,
        cursor: 0,
      }),
    );
  }, [debouncedContent, activeFile]);

  // ── Dirty tracking ────────────────────────────────────────────────────────────

  useEffect(() => {
    setIsDirty(editorContent !== savedContent);
  }, [editorContent, savedContent]);

  // ── File operations ───────────────────────────────────────────────────────────

  const openFile = useCallback((path: string) => {
    setActiveFile(path);
    wsRef.current?.send(JSON.stringify({ type: "file_open", path }));
  }, []);

  const saveFile = useCallback(() => {
    if (!activeFile || !wsRef.current || !isDirty) return;
    wsRef.current.send(
      JSON.stringify({ type: "file_save", path: activeFile, content: editorContentRef.current }),
    );
  }, [activeFile, isDirty]);

  const refreshFiles = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "list_workspace" }));
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [saveFile]);

  // ── AI sidecar ────────────────────────────────────────────────────────────────

  function sendToAgent(text: string) {
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "send", text }));
    setMessages((prev) => [...prev, { role: "user", text }]);
  }

  function interrupt() {
    wsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }

  // ── Status indicator ──────────────────────────────────────────────────────────

  const statusLabel =
    agentState === "disconnected"
      ? "○ offline"
      : agentState === "thinking"
      ? "◉ thinking"
      : "● ready";

  return (
    <div className="app">
      {/* Header */}
      <div className="app-header">
        <span className="app-header-title">Episteme</span>
        <span className="app-header-workspace">{workspaceName}</span>
        <div className="app-header-spacer" />
        <span className={`app-header-status${agentState === "thinking" ? " thinking" : ""}`}>
          {statusLabel}
        </span>
      </div>

      {/* Body */}
      <div className="app-body">
        <FileTree
          files={workspaceFiles}
          activeFile={activeFile}
          onFileSelect={openFile}
          onRefresh={refreshFiles}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <Editor
            content={editorContent}
            onUpdate={(md) => setEditorContent(md)}
          />

          {/* Status bar */}
          <div className="status-bar">
            {activeFile ? (
              <>
                <span className="status-bar-file">{activeFile.split("/").at(-1)}</span>
                {isDirty && (
                  <span style={{ color: "var(--text-dim)", fontSize: 10 }}>●</span>
                )}
              </>
            ) : (
              <span style={{ color: "var(--text-dim)" }}>No file open</span>
            )}
            <div className="status-bar-spacer" />
            {activeFile && isDirty && (
              <button className="status-bar-save" onClick={saveFile} title="Save (⌘S)">
                Save
              </button>
            )}
            {activeFile && !isDirty && (
              <span style={{ color: "var(--text-dim)", fontSize: 11 }}>Saved</span>
            )}
          </div>
        </div>

        <AISidecar
          messages={messages}
          isThinking={agentState === "thinking"}
          collapsed={sidecarCollapsed}
          onToggle={() => setSidecarCollapsed((c) => !c)}
          onSend={sendToAgent}
          onInterrupt={interrupt}
        />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
