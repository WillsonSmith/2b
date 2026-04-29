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
  | { type: "autocomplete_suggestion"; text: string }
  | { type: "insert_text"; text: string }
  | { type: "ingest_result"; success: boolean; message: string }
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

  // Autocomplete / outline
  const [ghostText, setGhostText] = useState("");
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);

  // Drag-drop
  const [isDragOver, setIsDragOver] = useState(false);

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
        ws.send(JSON.stringify({ type: "list_workspace" }));
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
        setTimeout(connect, 2000);
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
            setGhostText(""); // clear ghost on file switch
            break;
          case "file_saved":
            setSavedContent(editorContentRef.current);
            setIsDirty(false);
            break;
          case "autocomplete_suggestion":
            setGhostText(msg.text);
            break;
          case "insert_text": {
            // Outline result: append to editor content
            setEditorContent((prev) => {
              const sep = prev.trim() ? "\n\n" : "";
              return prev + sep + msg.text;
            });
            setIsGeneratingOutline(false);
            break;
          }
          case "ingest_result":
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                text: msg.success ? `Ingestion started: ${msg.message}` : `Ingest failed: ${msg.message}`,
              },
            ]);
            // Refresh file list so new research .md appears in tree
            wsRef.current?.send(JSON.stringify({ type: "list_workspace" }));
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

  // ── Autocomplete ──────────────────────────────────────────────────────────────

  const handleAutocompleteRequest = useCallback((context: string) => {
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "autocomplete_request", context }));
  }, [agentState]);

  const handleGhostAccept = useCallback(() => setGhostText(""), []);
  const handleGhostDismiss = useCallback(() => setGhostText(""), []);

  // ── Generate Outline ──────────────────────────────────────────────────────────

  const handleGenerateOutline = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected" || isGeneratingOutline) return;
    // Use the active file name or prompt the user via the sidecar
    const topic = activeFile
      ? activeFile.replace(/\.md$/i, "").split("/").at(-1) ?? "the current document"
      : "the current document";
    setIsGeneratingOutline(true);
    wsRef.current.send(JSON.stringify({ type: "outline_request", topic }));
  }, [agentState, activeFile, isGeneratingOutline]);

  // ── Drag-drop ─────────────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (!wsRef.current || agentState === "disconnected") return;

      // URL drop (links dragged from browser)
      const uriList = e.dataTransfer.getData("text/uri-list");
      if (uriList) {
        const urls = uriList.split("\n").map((u) => u.trim()).filter((u) => u.startsWith("http"));
        for (const url of urls) {
          wsRef.current.send(JSON.stringify({ type: "ingest_url", url }));
        }
        return;
      }

      // File drop — only support PDFs that are workspace-relative paths
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        if (file.name.endsWith(".pdf")) {
          // The drag delivers a File object; we send the filename and expect it to be in the workspace
          wsRef.current.send(JSON.stringify({ type: "ingest_pdf", path: file.name }));
        }
      }
    },
    [agentState],
  );

  // ── Status indicator ──────────────────────────────────────────────────────────

  const statusLabel =
    agentState === "disconnected"
      ? "○ offline"
      : agentState === "thinking"
      ? "◉ thinking"
      : "● ready";

  return (
    <div
      className="app"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="app-header">
        <span className="app-header-title">Episteme</span>
        <span className="app-header-workspace">{workspaceName}</span>
        <div className="app-header-spacer" />
        <span className={`app-header-status${agentState === "thinking" ? " thinking" : ""}`}>
          {statusLabel}
        </span>
      </div>

      {/* Drag-over overlay */}
      {isDragOver && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            pointerEvents: "none",
            fontSize: 24,
            color: "var(--text-main)",
          }}
        >
          Drop URL or PDF to ingest
        </div>
      )}

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
            onAutocompleteRequest={handleAutocompleteRequest}
            ghostText={ghostText}
            onGhostAccept={handleGhostAccept}
            onGhostDismiss={handleGhostDismiss}
            onGenerateOutline={handleGenerateOutline}
            isGeneratingOutline={isGeneratingOutline}
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
