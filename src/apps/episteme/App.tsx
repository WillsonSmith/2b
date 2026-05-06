import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Editor } from "./components/editor/Editor.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { AISidecar, type SidecarMessage } from "./components/AISidecar.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { ResearchPanel } from "./components/ResearchPanel.tsx";
import { ConflictsPanel } from "./components/ConflictsPanel.tsx";
import { KnowledgeGraph } from "./components/KnowledgeGraph.tsx";
import { ExportPanel } from "./components/ExportPanel.tsx";
import type { ExportFormat } from "./features/export.ts";
import type { WikilinkSuggestion } from "./features/autolink.ts";
import "./styles.css";
import { getShell } from "./shell/index.ts";
import { useWebSocket } from "./hooks/useWebSocket.ts";
import {
  Search,
  Zap,
  Network,
  Download,
  Settings,
  HelpCircle,
  X,
  Circle,
  CircleDot,
  CircleDashed,
} from "lucide-react";
import { useFileManager } from "./hooks/useFileManager.ts";
import { useEditorFeatures } from "./hooks/useEditorFeatures.ts";
import { useResearch } from "./hooks/useResearch.ts";
import { useConflictsAndGraph } from "./hooks/useConflictsAndGraph.ts";
import { useVoiceAndMedia } from "./hooks/useVoiceAndMedia.ts";

// ── Autolink suggestion banner ─────────────────────────────────────────────────

interface AutolinkBannerProps {
  suggestions: WikilinkSuggestion[];
  onAccept: (s: WikilinkSuggestion) => void;
  onDismiss: (s: WikilinkSuggestion) => void;
  onDismissAll: () => void;
}

function AutolinkBanner({
  suggestions,
  onAccept,
  onDismiss,
  onDismissAll,
}: AutolinkBannerProps) {
  const current = suggestions[0];
  if (!current) return null;
  const linkName =
    current.filename.split("/").at(-1)?.replace(/\.md$/i, "") ??
    current.filename;
  return (
    <div className="autolink-banner">
      <span className="autolink-text">
        Link <strong>"{current.text}"</strong> → <code>[[{linkName}]]</code>?
      </span>
      <button className="autolink-btn accept" onClick={() => onAccept(current)}>
        Accept
      </button>
      <button
        className="autolink-btn dismiss"
        onClick={() => onDismiss(current)}
      >
        Skip
      </button>
      {suggestions.length > 1 && (
        <button className="autolink-btn dismiss" onClick={onDismissAll}>
          Dismiss all ({suggestions.length})
        </button>
      )}
    </div>
  );
}

// ── Keyboard shortcut help panel ──────────────────────────────────────────────

function HelpPanel({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { key: "⌘S", desc: "Save file" },
    { key: "⌘F", desc: "Find in document" },
    { key: "⌘Z / ⌘⇧Z", desc: "Undo / Redo" },
    { key: "⌘B", desc: "Bold" },
    { key: "⌘I", desc: "Italic" },
    { key: "Tab", desc: "Accept ghost-text autocomplete" },
    { key: "Esc", desc: "Dismiss autocomplete" },
    { key: "Enter after /diagram: …", desc: "Generate Mermaid diagram" },
    { key: "?", desc: "Show this help" },
    { key: "Select text → bubble menu", desc: "Tone rewrite, TL;DR, Table" },
    { key: "Paste/drop image", desc: "Insert image with AI alt text" },
    { key: "Hover code block", desc: "Explain code with AI" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Keyboard Shortcuts</span>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <table className="help-table">
          <tbody>
            {shortcuts.map(({ key, desc }) => (
              <tr key={key} className="help-row">
                <td className="help-key">
                  <kbd>{key}</kbd>
                </td>
                <td className="help-desc">{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Large file warning ────────────────────────────────────────────────────────

function LargeFileBanner({
  charCount,
  onDismiss,
}: {
  charCount: number;
  onDismiss: () => void;
}) {
  return (
    <div className="large-file-banner">
      <span>
        This document is {(charCount / 1000).toFixed(0)}k characters — AI
        features may be slow or truncated.
      </span>
      <button className="autolink-btn dismiss" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [messages, setMessages] = useState<SidecarMessage[]>([]);
  const [sidecarCollapsed, setSidecarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pandocAvailable, setPandocAvailable] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [dismissedLargeFile, setDismissedLargeFile] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editorCounts, setEditorCounts] = useState({ words: 0, chars: 0 });
  const [indexProgress, setIndexProgress] = useState<{ indexed: number; total: number } | null>(null);

  const ws = useWebSocket();

  const fileManager = useFileManager(ws.wsRef, ws.agentState, ws.subscribe);
  const editorFeatures = useEditorFeatures(
    ws.wsRef,
    ws.agentState,
    fileManager.activeFile,
    fileManager.editorContent,
    fileManager.editorContentRef,
    fileManager.setEditorContent,
    ws.subscribe,
  );
  const research = useResearch(ws.wsRef, ws.agentState, ws.subscribe);
  const conflictsGraph = useConflictsAndGraph(
    ws.wsRef,
    ws.agentState,
    fileManager.openFile,
    ws.subscribe,
  );

  const onMicError = useCallback((text: string) => {
    setMessages((prev) => [...prev, { role: "assistant", text }]);
  }, []);
  const handleCountsChange = useCallback((words: number, chars: number) => {
    setEditorCounts({ words, chars });
  }, []);
  const voice = useVoiceAndMedia(
    ws.wsRef,
    ws.agentState,
    fileManager.setEditorContent,
    onMicError,
    ws.subscribe,
  );

  // ── Electron detection ───────────────────────────────────────────────────────

  useEffect(() => {
    if (getShell().platform() === "electron") {
      document.documentElement.classList.add("is-electron");
    }
  }, []);

  // ── Initial config load ──────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then(
        (data: {
          features?: { autocomplete?: boolean; autosave?: boolean; lint?: boolean };
        }) => {
          if (data.features?.autocomplete !== undefined)
            editorFeatures.setAutocompleteEnabled(data.features.autocomplete);
          if (data.features?.autosave !== undefined)
            fileManager.setAutosaveEnabled(data.features.autosave);
          if (data.features?.lint !== undefined)
            editorFeatures.setLintEnabled(data.features.lint);
        },
      )
      .catch(() => {});
  }, [editorFeatures.setAutocompleteEnabled, fileManager.setAutosaveEnabled]);

  // ── /api/health on each (re)connect ─────────────────────────────────────────

  const prevAgentStateRef = useRef<typeof ws.agentState>("disconnected");
  useEffect(() => {
    const wasDisconnected = prevAgentStateRef.current === "disconnected";
    const isConnected = ws.agentState !== "disconnected";
    if (wasDisconnected && isConnected) {
      fetch("/api/health")
        .then((r) => r.json())
        .then(
          (data: { workspace?: string | null; pandocAvailable?: boolean }) => {
            if (data.workspace) {
              const parts = data.workspace.split("/");
              fileManager.setWorkspaceName(parts.at(-1) ?? data.workspace);
              fileManager.setNeedsWorkspace(false);
            } else {
              fileManager.setNeedsWorkspace(true);
            }
            setPandocAvailable(data.pandocAvailable ?? false);
          },
        )
        .catch(() => {});
    }
    prevAgentStateRef.current = ws.agentState;
  }, [
    ws.agentState,
    fileManager.setWorkspaceName,
    fileManager.setNeedsWorkspace,
  ]);

  // ── "?" key opens help ──────────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.key === "?" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        setShowHelp((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── AI sidecar wrappers ─────────────────────────────────────────────────────

  const sendToAgent = useCallback(
    (text: string) => {
      if (ws.agentState === "disconnected") return;
      ws.sendToAgent(text);
      setMessages((prev) => [...prev, { role: "user", text }]);
    },
    [ws],
  );

  const interrupt = useCallback(() => {
    ws.interrupt();
  }, [ws]);

  const handleAskAboutSelection = useCallback(
    (text: string) => {
      if (!ws.wsRef.current) return;
      const msg = `[Selected text]\n\n${text}\n\n---\nWhat can you tell me about this?`;
      ws.wsRef.current.send(JSON.stringify({ type: "send", text: msg }));
      setMessages((prev) => [...prev, { role: "user", text: msg }]);
      setSidecarCollapsed(false);
    },
    [ws.wsRef],
  );

  const handleExplainCode = useCallback(
    (code: string, language: string) => {
      if (!ws.wsRef.current || ws.agentState === "disconnected") return;
      ws.wsRef.current.send(
        JSON.stringify({ type: "explain_code", code, language }),
      );
      setMessages((prev) => [
        ...prev,
        { role: "user", text: `Explain ${language} code block` },
      ]);
      setSidecarCollapsed(false);
    },
    [ws.agentState, ws.wsRef],
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
      if (!ws.wsRef.current || ws.agentState === "disconnected") return;

      const uriList = e.dataTransfer.getData("text/uri-list");
      if (uriList) {
        const urls = uriList
          .split("\n")
          .map((u) => u.trim())
          .filter((u) => u.startsWith("http"));
        for (const url of urls) {
          ws.wsRef.current.send(JSON.stringify({ type: "ingest_url", url }));
        }
        return;
      }

      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        if (file.name.endsWith(".pdf")) {
          ws.wsRef.current.send(
            JSON.stringify({ type: "ingest_pdf", path: file.name }),
          );
        } else if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(",")[1] ?? "";
            voice.handleImagePaste(base64, file.type, file.name);
          };
          reader.readAsDataURL(file);
        }
      }
    },
    [ws.agentState, ws.wsRef, voice],
  );

  // ── Export ─────────────────────────────────────────────────────────────────

  const handleExport = useCallback(
    async (format: ExportFormat, includeFrontmatter: boolean) => {
      if (!fileManager.activeFile || isExporting) return;
      setIsExporting(true);
      try {
        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath: fileManager.activeFile,
            format,
            includeFrontmatter,
          }),
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (data.url) {
          const a = document.createElement("a");
          a.href = data.url;
          a.download = data.url.split("/").at(-1) ?? "export";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setShowExport(false);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              text: `[Export error] ${data.error ?? "Unknown error"}`,
            },
          ]);
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "[Export error] Request failed." },
        ]);
      } finally {
        setIsExporting(false);
      }
    },
    [fileManager.activeFile, isExporting],
  );

  // ── Cross-cutting WebSocket subscriptions ───────────────────────────────────

  useEffect(() => {
    const unsubSpeak = ws.subscribe("speak", (msg) =>
      setMessages((prev) => [...prev, { role: "assistant", text: msg.text }]),
    );
    const unsubToolCall = ws.subscribe("tool_call", (msg) =>
      setMessages((prev) => [...prev, { role: "tool", name: msg.name, status: "calling" }]),
    );
    const unsubToolResult = ws.subscribe("tool_result", (msg) =>
      setMessages((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const m = prev[i];
          if (m && m.role === "tool" && m.name === msg.name && m.status === "calling") {
            const next = [...prev];
            next[i] = { role: "tool", name: msg.name, status: "done" };
            return next;
          }
        }
        return prev;
      }),
    );
    const unsubExplain = ws.subscribe("explain_code_result", (msg) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `**Code explanation:**\n\n${msg.explanation}` },
      ]);
      setSidecarCollapsed(false);
    });
    const unsubCheck = ws.subscribe("check_citations_result", (msg) => {
      const { valid, broken } = msg.result;
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Citations: ${valid.length} valid, ${broken.length} broken.${broken.length > 0 ? "\n\nBroken:\n" + broken.join("\n") : ""}`,
        },
      ]);
    });
    const unsubFormat = ws.subscribe("format_citation_result", (msg) =>
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `\`\`\`bibtex\n${msg.bibtex}\n\`\`\`` },
      ]),
    );
    const unsubIngest = ws.subscribe("ingest_result", (msg) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: msg.success ? `Ingestion started: ${msg.message}` : `Ingest failed: ${msg.message}`,
        },
      ]);
      fileManager.refreshFiles();
    });
    const unsubError = ws.subscribe("error", (msg) => {
      setMessages((prev) => [...prev, { role: "assistant", text: `[Error] ${msg.message}` }]);
      editorFeatures.setIsGeneratingMetadata(false);
      editorFeatures.setIsTocGenerating(false);
      research.setIsSearching(false);
      research.setIsDetectingGaps(false);
      conflictsGraph.setIsScanning(false);
      conflictsGraph.setIsLoadingGraph(false);
      setIsExporting(false);
    });
    const unsubFileContent = ws.subscribe("file_content", () => {
      editorFeatures.setGhostText("");
      editorFeatures.setLintIssues([]);
      editorFeatures.setAutolinkSuggestions([]);
      setDismissedLargeFile(false);
    });
    const unsubFileCreated = ws.subscribe("file_created", () => {
      editorFeatures.setGhostText("");
      editorFeatures.setLintIssues([]);
      editorFeatures.setAutolinkSuggestions([]);
    });
    const unsubIndex = ws.subscribe("index_progress", (msg) => {
      if (msg.total === 0 || msg.indexed >= msg.total) setIndexProgress(null);
      else setIndexProgress({ indexed: msg.indexed, total: msg.total });
    });
    return () => {
      unsubSpeak();
      unsubToolCall();
      unsubToolResult();
      unsubExplain();
      unsubCheck();
      unsubFormat();
      unsubIngest();
      unsubError();
      unsubFileContent();
      unsubFileCreated();
      unsubIndex();
    };
  }, [ws.subscribe, fileManager.refreshFiles, editorFeatures, research, conflictsGraph]);

  // ── Status indicator ──────────────────────────────────────────────────────────

  const statusLabel =
    ws.agentState === "disconnected" ? (
      <span className="icon-inline">
        <Circle size={10} /> offline
      </span>
    ) : ws.agentState === "thinking" ? (
      <span className="icon-inline">
        <CircleDashed size={10} /> thinking
      </span>
    ) : (
      <span className="icon-inline">
        <CircleDot size={10} /> ready
      </span>
    );

  const charCount = fileManager.editorContent.length;
  const showLargeFileWarning = charCount > 50_000 && !dismissedLargeFile;

  if (fileManager.needsWorkspace) {
    return (
      <div className="app">
        <div className="app-header"></div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "calc(100vh - 44px)",
            gap: 16,
          }}
        >
          <p style={{ color: "var(--text-muted)", fontSize: 15 }}>
            No workspace selected. Choose a folder to get started.
          </p>
          <button
            className="header-settings-btn"
            style={{ padding: "8px 20px", fontSize: 14 }}
            disabled={fileManager.isPickingWorkspace}
            onClick={fileManager.handleOpenWorkspace}
          >
            {fileManager.isPickingWorkspace ? "Opening…" : "Open Folder"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="app"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="app-header">
        <span className="app-header-workspace">
          {fileManager.workspaceName}
        </span>
        <div className="app-header-spacer" />
        <button
          className={`header-research-btn${research.showResearch ? " active" : ""}`}
          title="Research panel"
          onClick={() => research.setShowResearch((v) => !v)}
        >
          <Search size={16} />
        </button>
        <button
          className={`header-research-btn${conflictsGraph.showConflicts ? " active" : ""}`}
          title="Conflicts panel"
          onClick={() =>
            conflictsGraph.showConflicts
              ? conflictsGraph.setShowConflicts(false)
              : conflictsGraph.handleOpenConflicts()
          }
        >
          <Zap size={16} />
        </button>
        <button
          className={`header-research-btn${conflictsGraph.showGraph ? " active" : ""}`}
          title="Knowledge graph"
          onClick={() =>
            conflictsGraph.showGraph
              ? conflictsGraph.setShowGraph(false)
              : conflictsGraph.handleOpenGraph()
          }
        >
          <Network size={16} />
        </button>
        <button
          className="header-research-btn"
          title="Export document"
          onClick={() => setShowExport(true)}
        >
          <Download size={16} />
        </button>
        <button
          className="header-research-btn"
          title="Keyboard shortcuts (?)"
          onClick={() => setShowHelp(true)}
        >
          <HelpCircle size={16} />
        </button>
        <button
          className="header-settings-btn"
          title="Style Guide"
          onClick={() => setShowSettings(true)}
        >
          <Settings size={16} />
        </button>
        {indexProgress && (
          <span className="app-header-index-progress" title="Indexing workspace files">
            Indexing {indexProgress.indexed}/{indexProgress.total}
          </span>
        )}
        <span
          className={`app-header-status${ws.agentState === "thinking" ? " thinking" : ws.agentState === "disconnected" ? " disconnected" : ""}`}
        >
          {statusLabel}
        </span>
      </div>

      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onAutocompleteEnabledChange={editorFeatures.setAutocompleteEnabled}
          onAutosaveEnabledChange={fileManager.setAutosaveEnabled}
          onLintEnabledChange={editorFeatures.setLintEnabled}
        />
      )}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      {showExport && (
        <ExportPanel
          onClose={() => setShowExport(false)}
          onExport={handleExport}
          isExporting={isExporting}
          pandocAvailable={pandocAvailable}
          activeFile={fileManager.activeFile}
        />
      )}

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
          Drop URL, PDF, or image
        </div>
      )}

      {/* Autolink banner */}
      {editorFeatures.autolinkSuggestions.length > 0 && (
        <AutolinkBanner
          suggestions={editorFeatures.autolinkSuggestions}
          onAccept={editorFeatures.handleAutolinkAccept}
          onDismiss={editorFeatures.handleAutolinkDismiss}
          onDismissAll={editorFeatures.handleAutolinkDismissAll}
        />
      )}

      {/* Large file warning */}
      {showLargeFileWarning && (
        <LargeFileBanner
          charCount={charCount}
          onDismiss={() => setDismissedLargeFile(true)}
        />
      )}

      {/* Offline notice */}
      {ws.agentState === "disconnected" && (
        <div className="offline-banner">AI unavailable — reconnecting…</div>
      )}

      {/* Body */}
      <div className="app-body">
        <FileTree
          files={fileManager.workspaceFiles}
          activeFile={fileManager.activeFile}
          onFileSelect={fileManager.openFile}
          onRefresh={fileManager.refreshFiles}
          onCreateFile={fileManager.createFile}
          onRenameFile={fileManager.renameFile}
          tocEntries={editorFeatures.tocEntries}
          isTocGenerating={editorFeatures.isTocGenerating}
          onGenerateToc={editorFeatures.handleGenerateToc}
          onHeadingClick={editorFeatures.handleHeadingClick}
        />

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Editor
            content={fileManager.editorContent}
            onUpdate={(md) => fileManager.setEditorContent(md)}
            onAutocompleteRequest={editorFeatures.handleAutocompleteRequest}
            ghostText={editorFeatures.ghostText}
            onGhostAccept={editorFeatures.handleGhostAccept}
            onGhostDismiss={editorFeatures.handleGhostDismiss}
            onGenerateOutline={editorFeatures.handleGenerateOutline}
            isGeneratingOutline={editorFeatures.isGeneratingOutline}
            onToneRequest={editorFeatures.handleToneRequest}
            onSummarizeRequest={editorFeatures.handleSummarizeRequest}
            toneReplacement={editorFeatures.toneReplacement}
            summarizeResult={editorFeatures.summarizeResult}
            onToneApplied={() => editorFeatures.setToneReplacement(null)}
            onSummarizeApplied={() => editorFeatures.setSummarizeResult(null)}
            lintIssues={editorFeatures.lintIssues}
            onMetadataRequest={editorFeatures.handleMetadataRequest}
            isGeneratingMetadata={editorFeatures.isGeneratingMetadata}
            metadataResult={editorFeatures.metadataResult}
            onMetadataApplied={() => editorFeatures.setMetadataResult(null)}
            onTableRequest={editorFeatures.handleTableRequest}
            tableResult={editorFeatures.tableResult}
            onTableApplied={() => editorFeatures.setTableResult(null)}
            onDiagramRequest={editorFeatures.handleDiagramRequest}
            diagramResult={editorFeatures.diagramResult}
            onDiagramApplied={() => editorFeatures.setDiagramResult(null)}
            onImagePaste={voice.handleImagePaste}
            onExplainCode={handleExplainCode}
            isRecording={voice.isRecording}
            onToggleRecording={voice.handleToggleRecording}
            onAskAboutSelection={handleAskAboutSelection}
            onNavigate={fileManager.openFile}
            onCreateFile={fileManager.createFile}
            workspaceFiles={fileManager.workspaceFiles}
            onCountsChange={handleCountsChange}
          />

          {/* Status bar */}
          <div className="status-bar">
            {fileManager.activeFile ? (
              <>
                <span className="status-bar-file">
                  {fileManager.activeFile.split("/").at(-1)}
                </span>
                {fileManager.isDirty && (
                  <Circle
                    size={6}
                    fill="currentColor"
                    stroke="none"
                    style={{ color: "var(--text-dim)" }}
                  />
                )}
              </>
            ) : (
              <span style={{ color: "var(--text-dim)" }}>No file open</span>
            )}
            <div className="status-bar-spacer" />
            {fileManager.activeFile && (
              <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                {editorCounts.words.toLocaleString()} words ·{" "}
                {editorCounts.chars.toLocaleString()} chars
              </span>
            )}
            {fileManager.activeFile && fileManager.isDirty && (
              <button
                className="status-bar-save"
                onClick={fileManager.saveFile}
                title="Save (⌘S)"
              >
                Save
              </button>
            )}
            {fileManager.activeFile && !fileManager.isDirty && (
              <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                Saved
              </span>
            )}
          </div>
        </div>

        {research.showResearch && (
          <ResearchPanel
            onClose={() => research.setShowResearch(false)}
            onSearch={research.handleSearch}
            onDetectGaps={research.handleDetectGaps}
            onIngest={research.handleIngestFromSearch}
            onReindex={research.handleReindex}
            onSendToAgent={(text) => {
              sendToAgent(text);
              setSidecarCollapsed(false);
            }}
            searchResults={research.searchResults}
            gapReport={research.gapReport}
            isSearching={research.isSearching}
            isDetectingGaps={research.isDetectingGaps}
          />
        )}
        {conflictsGraph.showConflicts && (
          <ConflictsPanel
            onClose={() => conflictsGraph.setShowConflicts(false)}
            onRefresh={conflictsGraph.handleContradictionScan}
            contradictions={conflictsGraph.contradictions}
            isLoading={conflictsGraph.isScanning}
          />
        )}
        {conflictsGraph.showGraph && (
          <KnowledgeGraph
            onClose={() => conflictsGraph.setShowGraph(false)}
            onRefresh={conflictsGraph.handleRefreshGraph}
            onLoadMore={conflictsGraph.handleLoadMoreGraph}
            onNodeClick={conflictsGraph.handleGraphNodeClick}
            graphData={conflictsGraph.graphData}
            pagination={conflictsGraph.graphPagination}
            isLoading={conflictsGraph.isLoadingGraph}
          />
        )}
        <AISidecar
          messages={messages}
          isThinking={ws.agentState === "thinking"}
          collapsed={sidecarCollapsed}
          onToggle={() => setSidecarCollapsed((c) => !c)}
          onSend={sendToAgent}
          onInterrupt={interrupt}
          onNavigate={fileManager.openFile}
        />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
