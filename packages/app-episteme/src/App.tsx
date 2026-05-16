import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "./components/editor/Editor.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { TocPanel } from "./components/TocPanel.tsx";
import { AISidecar, type SidecarMessage } from "./components/AISidecar.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { ResearchPanel } from "./components/ResearchPanel.tsx";
import { ConflictsPanel } from "./components/ConflictsPanel.tsx";
import { KnowledgeGraph } from "./components/KnowledgeGraph.tsx";
import { PanelGroup, type PanelEntry } from "./components/PanelGroup.tsx";
import { UnifiedSearch, type SearchCommand } from "./components/UnifiedSearch.tsx";
import { PlanPanel } from "./components/PlanPanel.tsx";
import { usePlanning } from "./hooks/usePlanning.ts";
import "./styles.css";
import { getShell } from "./shell/index.ts";
import { useWebSocket } from "./hooks/useWebSocket.ts";
import {
  Search,
  Network,
  Settings,
  AlignLeft,
  Circle,
  ClipboardList,
} from "lucide-react";
import { useFileManager } from "./hooks/useFileManager.ts";
import { useEditorFeatures } from "./hooks/useEditorFeatures.ts";
import { useResearch } from "./hooks/useResearch.ts";
import { useConflictsAndGraph } from "./hooks/useConflictsAndGraph.ts";
import { useVoiceAndMedia } from "./hooks/useVoiceAndMedia.ts";

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
      <button className="large-file-banner-btn" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

function ExternalChangeBanner({
  onReload,
  onKeep,
}: {
  onReload: () => void;
  onKeep: () => void;
}) {
  return (
    <div className="large-file-banner">
      <span>This file was modified externally.</span>
      <button className="large-file-banner-btn" onClick={onReload}>
        Reload from disk
      </button>
      <button className="large-file-banner-btn" onClick={onKeep}>
        Keep my edits
      </button>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [messages, setMessages] = useState<SidecarMessage[]>([]);
  const [sidecarCollapsed, setSidecarCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"style" | "models" | "help">("style");
  const [showToc, setShowToc] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [dismissedLargeFile, setDismissedLargeFile] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editorCounts, setEditorCounts] = useState({ words: 0, chars: 0 });
  const [editorMode, setEditorMode] = useState<"formatted" | "markdown">("formatted");
  const [indexProgress, setIndexProgress] = useState<{
    indexed: number;
    total: number;
  } | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState("");

  const ws = useWebSocket();
  const planning = usePlanning(ws.wsRef, ws.subscribe);

  // Auto-open the plan panel when a plan is created or already active on connect
  useEffect(() => {
    if (planning.plan) setShowPlan(true);
  }, [planning.plan !== null]);

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
          features?: {
            autocomplete?: boolean;
            autosave?: boolean;
            lint?: boolean;
          };
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
          (data: { workspace?: string | null }) => {
            if (data.workspace) {
              const parts = data.workspace.split("/");
              fileManager.setWorkspaceName(parts.at(-1) ?? data.workspace);
              fileManager.setNeedsWorkspace(false);
              setWorkspaceRoot(data.workspace);
              fetch("/api/chat-history")
                .then((r) => r.json())
                .then(
                  (
                    rows: Array<{ role: "user" | "assistant"; text: string }>,
                  ) => {
                    setMessages(
                      rows.map((r) => ({ role: r.role, text: r.text })),
                    );
                  },
                )
                .catch(() => {});
            } else {
              fileManager.setNeedsWorkspace(true);
            }
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
        e.key === "F1" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        setSettingsInitialTab("help");
        setShowSettings(true);
      }
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── AI sidecar wrappers ─────────────────────────────────────────────────────

  const sendToAgent = useCallback(
    async (text: string) => {
      if (ws.agentState === "disconnected") return;

      const mentionPattern = /@([\w\-./ ]+\.md)/g;
      const mentions = [...text.matchAll(mentionPattern)].map((m) => m[1].trim());

      let fullText = text;
      if (mentions.length > 0) {
        const fetched = await Promise.all(
          mentions.map((path) =>
            fetch(`/api/file-content?path=${encodeURIComponent(path)}`)
              .then((r) => r.json() as Promise<{ content?: string }>)
              .then((d) => (d.content != null ? { path, content: d.content } : null))
              .catch(() => null),
          ),
        );
        const blocks = fetched
          .filter((f): f is { path: string; content: string } => f !== null)
          .map((f) => `[File: ${f.path}]\n\`\`\`\n${f.content}\n\`\`\``)
          .join("\n\n");
        if (blocks) fullText = `${blocks}\n\n---\n${text}`;
      }

      ws.sendToAgent(fullText);
      setMessages((prev) => [...prev, { role: "user", text }]);
    },
    [ws],
  );

  const interrupt = useCallback(() => {
    ws.interrupt();
  }, [ws]);

  const onContinueFrom = useCallback((afterIndex, text) => {
    setMessages((prev) => prev.slice(0, afterIndex + 1));
    sendToAgent(text);
  }, [sendToAgent]);

  const onDeleteMessage = useCallback((index: number) => {
    setMessages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const searchCommands = useMemo<SearchCommand[]>(
    () => [
      { id: "toc", label: "Table of Contents", description: "Toggle TOC panel", action: () => setShowToc((v) => !v) },
      { id: "research", label: "Research Panel", description: "Search arXiv, Wikipedia & workspace", action: () => research.setShowResearch((v) => !v) },
      { id: "conflicts", label: "Conflicts Panel", description: "Detect contradictions", action: () => conflictsGraph.showConflicts ? conflictsGraph.setShowConflicts(false) : conflictsGraph.handleOpenConflicts() },
      { id: "graph", label: "Knowledge Graph", description: "Visualize note connections", action: () => conflictsGraph.showGraph ? conflictsGraph.setShowGraph(false) : conflictsGraph.handleOpenGraph() },
      { id: "settings", label: "Settings", description: "Style guide & features", action: () => setShowSettings(true) },
      { id: "help", label: "Keyboard Shortcuts", description: "View all shortcuts", action: () => { setSettingsInitialTab("help"); setShowSettings(true); } },
      { id: "newfile", label: "New File", description: "Create a new note", action: () => fileManager.createFile("untitled.md") },
      { id: "reindex", label: "Re-index Workspace", description: "Update search index", action: () => research.handleReindex() },
      { id: "save", label: "Save File", description: "Save current document", action: () => fileManager.saveFile() },
    ],
    [
      research,
      conflictsGraph,
      fileManager,
    ],
  );

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
    const isExternal = e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list");
    if (!isExternal) return;
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

  // ── Cross-cutting WebSocket subscriptions ───────────────────────────────────

  useEffect(() => {
    const unsubSpeak = ws.subscribe("speak", (msg) =>
      setMessages((prev) => [...prev, { role: "assistant", text: msg.text }]),
    );
    const unsubToolCall = ws.subscribe("tool_call", (msg) =>
      setMessages((prev) => [
        ...prev,
        { role: "tool", name: msg.name, status: "calling" },
      ]),
    );
    const unsubToolResult = ws.subscribe("tool_result", (msg) =>
      setMessages((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const m = prev[i];
          if (
            m &&
            m.role === "tool" &&
            m.name === msg.name &&
            m.status === "calling"
          ) {
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
        {
          role: "assistant",
          text: `**Code explanation:**\n\n${msg.explanation}`,
        },
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
          text: msg.success
            ? `Ingestion started: ${msg.message}`
            : `Ingest failed: ${msg.message}`,
        },
      ]);
      fileManager.refreshFiles();
    });
    const unsubError = ws.subscribe("error", (msg) => {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `[Error] ${msg.message}` },
      ]);
      editorFeatures.setIsGeneratingMetadata(false);
      editorFeatures.setIsTocGenerating(false);
      research.setIsSearching(false);
      research.setIsDetectingGaps(false);
      conflictsGraph.setIsScanning(false);
      conflictsGraph.setIsLoadingGraph(false);
    });
    const unsubFileContent = ws.subscribe("file_content", () => {
      editorFeatures.setGhostText("");
      editorFeatures.setLintIssues([]);
      setDismissedLargeFile(false);
    });
    const unsubFileCreated = ws.subscribe("file_created", () => {
      editorFeatures.setGhostText("");
      editorFeatures.setLintIssues([]);
    });
    const unsubIndex = ws.subscribe("index_progress", (msg) => {
      if (msg.total === 0 || msg.indexed >= msg.total) setIndexProgress(null);
      else setIndexProgress({ indexed: msg.indexed, total: msg.total });
    });
    const unsubContradictionNotif = ws.subscribe("contradiction_notification", (msg) => {
      const label = msg.count === 1 ? "1 contradiction" : `${msg.count} contradictions`;
      setMessages((prev) => [
        ...prev,
        {
          role: "notification",
          text: `Background scan found ${label}.`,
          actionLabel: "View",
          onAction: () => {
            conflictsGraph.handleOpenConflicts();
            setSidecarCollapsed(false);
          },
        },
      ]);
      setSidecarCollapsed(false);
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
      unsubContradictionNotif();
    };
  }, [
    ws.subscribe,
    fileManager.refreshFiles,
    editorFeatures,
    research,
    conflictsGraph,
  ]);

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
        <button
          className="header-search-trigger"
          onClick={() => setShowSearch(true)}
          title="Unified search (⌘K)"
        >
          <Search size={13} />
          <span>Search…</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="app-header-actions">
          <button
            className={`header-research-btn${showToc ? " active" : ""}`}
            title="Table of contents"
            onClick={() => setShowToc((v) => !v)}
          >
            <AlignLeft size={16} />
          </button>
          <button
            className={`header-research-btn${research.showResearch ? " active" : ""}`}
            title="Research panel"
            onClick={() => research.setShowResearch((v) => !v)}
          >
            <Search size={16} />
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
            className={`header-research-btn${showPlan ? " active" : ""}`}
            title="Plan panel"
            onClick={() => setShowPlan((v) => !v)}
          >
            <ClipboardList size={16} />
          </button>
          <button
            className="header-research-btn"
            title="Settings"
            onClick={() => { setSettingsInitialTab("style"); setShowSettings(true); }}
          >
            <Settings size={16} />
          </button>
          {indexProgress && (
            <span
              className="app-header-index-progress"
              title="Indexing workspace files"
            >
              Indexing {indexProgress.indexed}/{indexProgress.total}
            </span>
          )}
        </div>
      </div>

      <UnifiedSearch
        open={showSearch}
        onClose={() => setShowSearch(false)}
        workspaceFiles={fileManager.workspaceFiles}
        onFileSelect={(path) => { fileManager.openFile(path); setShowSearch(false); }}
        onResearchSearch={(q) => {
          research.handleSearch(q);
          research.setShowResearch(true);
          setShowSearch(false);
        }}
        researchResults={research.searchResults}
        isResearching={research.isSearching}
        commands={searchCommands}
      />
      {showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onAutocompleteEnabledChange={editorFeatures.setAutocompleteEnabled}
          onAutosaveEnabledChange={fileManager.setAutosaveEnabled}
          onLintEnabledChange={editorFeatures.setLintEnabled}
          initialTab={settingsInitialTab}
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
          folders={fileManager.workspaceFolders}
          activeFile={fileManager.activeFile}
          onFileSelect={fileManager.openFile}
          onRefresh={fileManager.refreshFiles}
          onCreateFile={fileManager.createFile}
          onCreateFolder={fileManager.createFolder}
          onRenameFile={fileManager.renameFile}
          onRenameFolder={fileManager.renameFolder}
          onOpenInFinder={fileManager.openInFinder}
          workspaceRoot={workspaceRoot}
        />

        <div
          style={{
            flex: 1,
            minWidth: 320,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {fileManager.externalContent !== null && (
            <ExternalChangeBanner
              onReload={() => fileManager.resolveExternalConflict("reload")}
              onKeep={() => fileManager.resolveExternalConflict("keep")}
            />
          )}
          <Editor
            content={fileManager.editorContent}
            onUpdate={(md) => fileManager.setEditorContent(md)}
            onAutocompleteRequest={editorFeatures.handleAutocompleteRequest}
            ghostText={editorFeatures.ghostText}
            onGhostAccept={editorFeatures.handleGhostAccept}
            onGhostDismiss={editorFeatures.handleGhostDismiss}
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
            editorMode={editorMode}
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
              <label className="settings-toggle" title="Toggle Markdown / Formatted view">
                <input
                  type="checkbox"
                  checked={editorMode === "markdown"}
                  onChange={() => setEditorMode(m => m === "formatted" ? "markdown" : "formatted")}
                />
                <span className="settings-toggle-track" />
                <span className="status-bar-mode-label">Markdown</span>
              </label>
            )}
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

        {(() => {
          const panels: PanelEntry[] = [];
          if (showToc) panels.push({
            id: "toc",
            label: "TOC",
            defaultWidth: 220,
            onClose: () => setShowToc(false),
            content: (
              <TocPanel
                content={fileManager.editorContent}
                tocEntries={editorFeatures.tocEntries}
                isAnnotating={editorFeatures.isTocGenerating}
                onAnnotate={editorFeatures.handleGenerateToc}
                onClose={() => setShowToc(false)}
              />
            ),
          });
          if (research.showResearch) panels.push({
            id: "research",
            label: "Research",
            defaultWidth: 320,
            onClose: () => research.setShowResearch(false),
            content: (
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
            ),
          });
          if (conflictsGraph.showConflicts) panels.push({
            id: "conflicts",
            label: "Conflicts",
            defaultWidth: 320,
            onClose: () => conflictsGraph.setShowConflicts(false),
            content: (
              <ConflictsPanel
                onClose={() => conflictsGraph.setShowConflicts(false)}
                onRefresh={conflictsGraph.handleContradictionScan}
                contradictions={conflictsGraph.contradictions}
                isLoading={conflictsGraph.isScanning}
              />
            ),
          });
          if (showPlan) panels.push({
            id: "plan",
            label: "Plan",
            defaultWidth: 300,
            onClose: () => setShowPlan(false),
            content: (
              <PlanPanel
                plan={planning.plan}
                activeFile={fileManager.activeFile}
                agentState={ws.agentState}
                onClose={() => setShowPlan(false)}
                onRequestPlan={planning.requestPlan}
                onRequestPlanFromDocument={planning.requestPlanFromDocument}
                onApprovePlan={planning.approvePlan}
                onApproveStep={planning.approveStep}
                onRetryStep={planning.retryStep}
                onSkipStep={planning.skipStep}
                onAmendSteps={planning.amendSteps}
                onEditStepSummary={planning.editStepSummary}
                onEditStepInstruction={planning.editStepInstruction}
                onAddStep={planning.addStep}
                onReorderStep={planning.reorderStep}
                onPause={planning.pausePlan}
                onResume={planning.resumePlan}
                onResumeAuto={planning.resumeAuto}
                onCancel={planning.cancelPlan}
                onNewPlan={planning.resetPlan}
              />
            ),
          });
          if (conflictsGraph.showGraph) panels.push({
            id: "graph",
            label: "Graph",
            defaultWidth: 420,
            onClose: () => conflictsGraph.setShowGraph(false),
            content: (
              <KnowledgeGraph
                onClose={() => conflictsGraph.setShowGraph(false)}
                onRefresh={conflictsGraph.handleRefreshGraph}
                onReindex={conflictsGraph.handleReindex}
                onLoadMore={conflictsGraph.handleLoadMoreGraph}
                onNodeClick={conflictsGraph.handleGraphNodeClick}
                graphData={conflictsGraph.graphData}
                pagination={conflictsGraph.graphPagination}
                isLoading={conflictsGraph.isLoadingGraph}
              />
            ),
          });
          return <PanelGroup panels={panels} />;
        })()}
        <AISidecar
          messages={messages}
          isThinking={ws.agentState === "thinking"}
          agentState={ws.agentState}
          collapsed={sidecarCollapsed}
          onToggle={() => setSidecarCollapsed((c) => !c)}
          onSend={sendToAgent}
          onInterrupt={interrupt}
          onNavigate={fileManager.openFile}
          workspaceFiles={fileManager.workspaceFiles}
          onContinueFrom={onContinueFrom}
          onDeleteMessage={onDeleteMessage}
        />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
