import { createRoot } from "react-dom/client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Editor } from "./components/Editor.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { AISidecar, type SidecarMessage } from "./components/AISidecar.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import type { Tone } from "./features/tone.ts";
import type { LintIssue } from "./features/lint.ts";
import type { TocEntry } from "./features/toc.ts";
import type { WikilinkSuggestion } from "./features/autolink.ts";
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
  | { type: "tone_result"; text: string; from: number; to: number }
  | { type: "summarize_result"; text: string; insertPos: number }
  | { type: "lint_result"; issues: LintIssue[] }
  | { type: "metadata_result"; yaml: string }
  | { type: "toc_result"; entries: TocEntry[] }
  | { type: "autolink_result"; suggestions: WikilinkSuggestion[] }
  | { type: "diagram_result"; code: string; from: number; to: number }
  | { type: "table_result"; text: string; insertPos: number }
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

// ── Autolink suggestion banner ─────────────────────────────────────────────────

interface AutolinkBannerProps {
  suggestions: WikilinkSuggestion[];
  onAccept: (s: WikilinkSuggestion) => void;
  onDismiss: (s: WikilinkSuggestion) => void;
  onDismissAll: () => void;
}

function AutolinkBanner({ suggestions, onAccept, onDismiss, onDismissAll }: AutolinkBannerProps) {
  const current = suggestions[0];
  if (!current) return null;
  const linkName = current.filename.split("/").at(-1)?.replace(/\.md$/i, "") ?? current.filename;
  return (
    <div className="autolink-banner">
      <span className="autolink-text">
        Link <strong>"{current.text}"</strong> → <code>[[{linkName}]]</code>?
      </span>
      <button className="autolink-btn accept" onClick={() => onAccept(current)}>Accept</button>
      <button className="autolink-btn dismiss" onClick={() => onDismiss(current)}>Skip</button>
      {suggestions.length > 1 && (
        <button className="autolink-btn dismiss" onClick={onDismissAll}>
          Dismiss all ({suggestions.length})
        </button>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [agentState, setAgentState] = useState<"idle" | "thinking" | "disconnected">("disconnected");
  const [messages, setMessages] = useState<SidecarMessage[]>([]);
  const [sidecarCollapsed, setSidecarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Editor state
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // Autocomplete / outline
  const [ghostText, setGhostText] = useState("");
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);

  // Tone / summarize
  const [toneReplacement, setToneReplacement] = useState<{ text: string; from: number; to: number } | null>(null);
  const [summarizeResult, setSummarizeResult] = useState<{ text: string; insertPos: number } | null>(null);

  // Lint
  const [lintIssues, setLintIssues] = useState<LintIssue[]>([]);

  // Drag-drop
  const [isDragOver, setIsDragOver] = useState(false);

  // Workspace
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceName, setWorkspaceName] = useState("workspace");

  // Metadata (frontmatter)
  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);
  const [metadataResult, setMetadataResult] = useState<string | null>(null);

  // TOC
  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [isTocGenerating, setIsTocGenerating] = useState(false);

  // Autolink
  const [autolinkSuggestions, setAutolinkSuggestions] = useState<WikilinkSuggestion[]>([]);

  // Diagram
  const [diagramResult, setDiagramResult] = useState<{ code: string; from: number; to: number } | null>(null);

  // Table
  const [tableResult, setTableResult] = useState<{ text: string; insertPos: number } | null>(null);

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
            setGhostText("");
            setLintIssues([]);
            setAutolinkSuggestions([]);
            break;
          case "file_saved":
            setSavedContent(editorContentRef.current);
            setIsDirty(false);
            break;
          case "autocomplete_suggestion":
            setGhostText(msg.text);
            break;
          case "insert_text": {
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
            wsRef.current?.send(JSON.stringify({ type: "list_workspace" }));
            break;
          case "lint_result":
            setLintIssues(msg.issues);
            break;
          case "tone_result":
            setToneReplacement({ text: msg.text, from: msg.from, to: msg.to });
            break;
          case "summarize_result":
            setSummarizeResult({ text: msg.text, insertPos: msg.insertPos });
            break;
          case "metadata_result":
            setMetadataResult(msg.yaml);
            setIsGeneratingMetadata(false);
            break;
          case "toc_result":
            setTocEntries(msg.entries);
            setIsTocGenerating(false);
            break;
          case "autolink_result":
            setAutolinkSuggestions(msg.suggestions);
            break;
          case "diagram_result":
            setDiagramResult({ code: msg.code, from: msg.from, to: msg.to });
            break;
          case "table_result":
            setTableResult({ text: msg.text, insertPos: msg.insertPos });
            break;
          case "error":
            setMessages((prev) => [
              ...prev,
              { role: "assistant", text: `[Error] ${msg.message}` },
            ]);
            setIsGeneratingMetadata(false);
            setIsTocGenerating(false);
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
    const topic = activeFile
      ? activeFile.replace(/\.md$/i, "").split("/").at(-1) ?? "the current document"
      : "the current document";
    setIsGeneratingOutline(true);
    wsRef.current.send(JSON.stringify({ type: "outline_request", topic }));
  }, [agentState, activeFile, isGeneratingOutline]);

  // ── Tone / Summarize ──────────────────────────────────────────────────────────

  const handleToneRequest = useCallback(
    (text: string, tone: Tone, from: number, to: number) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "tone_transform", text, tone, from, to }));
    },
    [agentState],
  );

  const handleSummarizeRequest = useCallback(
    (text: string, insertPos: number) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "summarize_request", text, insertPos }));
    },
    [agentState],
  );

  // ── Metadata (frontmatter) ────────────────────────────────────────────────────

  const handleMetadataRequest = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected" || isGeneratingMetadata) return;
    const title = activeFile
      ? activeFile.replace(/\.md$/i, "").split("/").at(-1) ?? ""
      : "";
    const preview = editorContentRef.current;
    setIsGeneratingMetadata(true);
    wsRef.current.send(JSON.stringify({ type: "metadata_request", title, preview }));
  }, [agentState, activeFile, isGeneratingMetadata]);

  // ── TOC ───────────────────────────────────────────────────────────────────────

  const handleGenerateToc = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected" || isTocGenerating) return;
    const markdown = editorContentRef.current;
    if (!markdown.trim()) return;
    setIsTocGenerating(true);
    wsRef.current.send(JSON.stringify({ type: "toc_request", markdown }));
  }, [agentState, isTocGenerating]);

  const handleHeadingClick = useCallback((_id: string, text: string) => {
    // Scroll the editor to the heading by searching for it in the content
    const headingEl = document.querySelector(".tiptap")?.querySelector("h1, h2, h3, h4, h5, h6");
    if (!headingEl) return;
    const allHeadings = document.querySelectorAll(".tiptap h1, .tiptap h2, .tiptap h3, .tiptap h4, .tiptap h5, .tiptap h6");
    for (const el of allHeadings) {
      if (el.textContent?.trim() === text) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      }
    }
  }, []);

  // ── Autolink ──────────────────────────────────────────────────────────────────

  const handleAutolinkAccept = useCallback((suggestion: WikilinkSuggestion) => {
    const linkName = suggestion.filename.split("/").at(-1)?.replace(/\.md$/i, "") ?? suggestion.filename;
    const wikilink = `[[${linkName}]]`;
    const content = editorContentRef.current;
    const updated = content.slice(0, suggestion.offset) +
      wikilink +
      content.slice(suggestion.offset + suggestion.text.length);
    setEditorContent(updated);
    // Remove accepted suggestion and re-index offsets for remaining suggestions
    setAutolinkSuggestions((prev) =>
      prev
        .filter((s) => s !== suggestion)
        .map((s) => ({
          ...s,
          offset: s.offset > suggestion.offset
            ? s.offset + (wikilink.length - suggestion.text.length)
            : s.offset,
        })),
    );
  }, []);

  const handleAutolinkDismiss = useCallback((suggestion: WikilinkSuggestion) => {
    setAutolinkSuggestions((prev) => prev.filter((s) => s !== suggestion));
  }, []);

  const handleAutolinkDismissAll = useCallback(() => {
    setAutolinkSuggestions([]);
  }, []);

  // ── Diagram ───────────────────────────────────────────────────────────────────

  const handleDiagramRequest = useCallback(
    (description: string, from: number, to: number) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "diagram_request", description, from, to }));
    },
    [agentState],
  );

  // ── Table ─────────────────────────────────────────────────────────────────────

  const handleTableRequest = useCallback(
    (text: string, insertPos: number) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "table_request", text, insertPos }));
    },
    [agentState],
  );

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

      const uriList = e.dataTransfer.getData("text/uri-list");
      if (uriList) {
        const urls = uriList.split("\n").map((u) => u.trim()).filter((u) => u.startsWith("http"));
        for (const url of urls) {
          wsRef.current.send(JSON.stringify({ type: "ingest_url", url }));
        }
        return;
      }

      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        if (file.name.endsWith(".pdf")) {
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
        <button
          className="header-settings-btn"
          title="Style Guide"
          onClick={() => setShowSettings(true)}
        >
          ⚙
        </button>
        <span className={`app-header-status${agentState === "thinking" ? " thinking" : ""}`}>
          {statusLabel}
        </span>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

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

      {/* Autolink banner */}
      {autolinkSuggestions.length > 0 && (
        <AutolinkBanner
          suggestions={autolinkSuggestions}
          onAccept={handleAutolinkAccept}
          onDismiss={handleAutolinkDismiss}
          onDismissAll={handleAutolinkDismissAll}
        />
      )}

      {/* Body */}
      <div className="app-body">
        <FileTree
          files={workspaceFiles}
          activeFile={activeFile}
          onFileSelect={openFile}
          onRefresh={refreshFiles}
          tocEntries={tocEntries}
          isTocGenerating={isTocGenerating}
          onGenerateToc={handleGenerateToc}
          onHeadingClick={handleHeadingClick}
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
            onToneRequest={handleToneRequest}
            onSummarizeRequest={handleSummarizeRequest}
            toneReplacement={toneReplacement}
            summarizeResult={summarizeResult}
            onToneApplied={() => setToneReplacement(null)}
            onSummarizeApplied={() => setSummarizeResult(null)}
            lintIssues={lintIssues}
            onMetadataRequest={handleMetadataRequest}
            isGeneratingMetadata={isGeneratingMetadata}
            metadataResult={metadataResult}
            onMetadataApplied={() => setMetadataResult(null)}
            onTableRequest={handleTableRequest}
            tableResult={tableResult}
            onTableApplied={() => setTableResult(null)}
            onDiagramRequest={handleDiagramRequest}
            diagramResult={diagramResult}
            onDiagramApplied={() => setDiagramResult(null)}
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
