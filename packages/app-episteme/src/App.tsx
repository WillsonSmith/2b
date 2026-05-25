import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "./components/editor/Editor.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { TocPanel } from "./components/TocPanel.tsx";
import { AISidecar } from "./components/AISidecar.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { OnboardingModal } from "./components/OnboardingModal.tsx";
import { PermissionDialog } from "./components/PermissionDialog.tsx";
import { ResearchPanel } from "./components/ResearchPanel.tsx";
import { ConflictsPanel } from "./components/ConflictsPanel.tsx";
import { KnowledgeGraph } from "./components/KnowledgeGraph.tsx";
import { PanelGroup, type PanelEntry } from "./components/PanelGroup.tsx";
import { UnifiedSearch, type SearchCommand } from "./components/UnifiedSearch.tsx";
import { PlanPanel } from "./components/PlanPanel.tsx";
import { usePlanning } from "./hooks/usePlanning.ts";
import "./styles.css";
import { getShell } from "./shell/index.ts";
import { useWebSocket, type UseWebSocketReturn } from "./hooks/useWebSocket.ts";
import {
  Search,
  Network,
  Settings,
  AlignLeft,
  Circle,
  ClipboardList,
  Sparkles,
  Sun,
  Moon,
  PanelLeft,
  Focus,
} from "lucide-react";
import type { WritingAidsConfig } from "./config.ts";
import { themedColor, HIGHLIGHT_CSS_VARS, type HighlightColorKey } from "./features/themedColor.ts";
import { useFileManager } from "./hooks/useFileManager.ts";
import { useFileTreeState } from "./hooks/useFileTreeState.ts";
import { useEditorFeatures } from "./hooks/useEditorFeatures.ts";
import { useResearch } from "./hooks/useResearch.ts";
import { useConflictsAndGraph } from "./hooks/useConflictsAndGraph.ts";
import { useVoiceAndMedia } from "./hooks/useVoiceAndMedia.ts";
import { AIProvider, useAI, type HistoryRow } from "./state/AIContext.tsx";
import { UIProvider, useUI } from "./state/UIContext.tsx";
import { FileProvider, useFiles } from "./state/FileContext.tsx";
import { EditorProvider, useEditor } from "./state/EditorContext.tsx";
import { PlanningProvider, usePlanningCtx } from "./state/PlanningContext.tsx";
import { useSignalValue } from "./state/signals.ts";

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

// ── App hierarchy ─────────────────────────────────────────────────────────────
//
// UIProvider sits outside everything so AppShell can build AIProvider's
// onSendToPlan callback by writing to UI signals. AppShell owns the hooks.
// AppBody (inside AIProvider) holds the JSX and uses both contexts. Phase 3
// will collapse most of AppBody's remaining prop list by moving file/workspace
// state into a FileContext.

function App() {
  return (
    <UIProvider>
      <AppShell />
    </UIProvider>
  );
}

function AppShell() {
  const ui = useUI();
  const ws = useWebSocket();
  const planning = usePlanning(ws.wsRef, ws.subscribe);
  const fileManager = useFileManager(ws.wsRef, ws.agentState, ws.subscribe);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const fileTreeState = useFileTreeState(ws.wsRef, ws.agentState, ws.subscribe, workspaceRoot);
  const editorFeatures = useEditorFeatures(
    ws.wsRef,
    ws.agentState,
    fileManager.activeFile,
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
    // Mic errors are surfaced via console for now; previously they were pushed
    // into the chat. AIProvider doesn't have a public "push assistant text"
    // action, and this path is rare. Revisit if user reports voice issues.
    console.error("[mic]", text);
  }, []);
  const voice = useVoiceAndMedia(
    ws.wsRef,
    ws.agentState,
    fileManager.setEditorContent,
    onMicError,
    ws.subscribe,
  );

  const handleSendToPlan = useCallback((text: string) => {
    ui.planSeedGoal.value = text;
    ui.showPlan.value = true;
  }, [ui]);
  const handleContradictionOpen = useCallback(() => {
    conflictsGraph.handleOpenConflicts();
  }, [conflictsGraph]);
  const handleIngestComplete = useCallback(() => {
    fileManager.refreshFiles();
  }, [fileManager]);

  return (
    <AIProvider
      ws={ws}
      planning={planning}
      onSendToPlan={handleSendToPlan}
      onContradictionNotify={handleContradictionOpen}
      onIngestComplete={handleIngestComplete}
    >
      <FileProvider
        fileManager={fileManager}
        fileTreeState={fileTreeState}
        workspaceRoot={workspaceRoot}
        setWorkspaceRoot={setWorkspaceRoot}
      >
        <EditorProvider editorFeatures={editorFeatures}>
          <PlanningProvider planning={planning}>
            <AppBody
              ws={ws}
              research={research}
              conflictsGraph={conflictsGraph}
              voice={voice}
            />
          </PlanningProvider>
        </EditorProvider>
      </FileProvider>
    </AIProvider>
  );
}

interface AppBodyProps {
  ws: UseWebSocketReturn;
  research: ReturnType<typeof useResearch>;
  conflictsGraph: ReturnType<typeof useConflictsAndGraph>;
  voice: ReturnType<typeof useVoiceAndMedia>;
}

function AppBody({
  ws,
  research,
  conflictsGraph,
  voice,
}: AppBodyProps) {
  const ai = useAI();
  const ui = useUI();
  const file = useFiles();
  const editor = useEditor();
  const planning = usePlanningCtx();
  const plan = useSignalValue(planning.plan);
  const sidecarCollapsed = useSignalValue(ai.sidecarCollapsed);
  const providerStatus = useSignalValue(ai.providerStatus);
  const providerBannerDismissed = useSignalValue(ai.providerBannerDismissed);
  const fileTreeCollapsed = useSignalValue(ui.fileTreeCollapsed);
  const activeFile = useSignalValue(file.activeFile);
  const editorContent = useSignalValue(file.editorContent);
  const workspaceFiles = useSignalValue(file.workspaceFiles);
  const workspaceName = useSignalValue(file.workspaceName);
  const isDirty = useSignalValue(file.isDirty);
  const externalContent = useSignalValue(file.externalContent);
  const needsWorkspace = useSignalValue(file.needsWorkspace);
  const isPickingWorkspace = useSignalValue(file.isPickingWorkspace);
  const expandedDirs = useSignalValue(file.expandedDirs);
  const focusSnapshot = useSignalValue(ui.focusSnapshot);
  const showSettings = useSignalValue(ui.showSettings);
  const settingsInitialSection = useSignalValue(ui.settingsInitialSection);
  const showToc = useSignalValue(ui.showToc);
  const showSearch = useSignalValue(ui.showSearch);
  const showPlan = useSignalValue(ui.showPlan);
  const dismissedLargeFile = useSignalValue(ui.dismissedLargeFile);
  const isDragOver = useSignalValue(ui.isDragOver);
  const editorMode = useSignalValue(ui.editorMode);
  const editorCounts = useSignalValue(ui.editorCounts);
  const indexProgress = useSignalValue(ui.indexProgress);

  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const themeReady = useRef(false);
  const [writingAids, setWritingAids] = useState<WritingAidsConfig>({});
  const [editorCommand, setEditorCommand] = useState<{ name: string; nonce: number } | null>(null);
  const editorCommandNonce = useRef(0);
  const dispatchEditorCommand = useCallback((name: string) => {
    editorCommandNonce.current += 1;
    setEditorCommand({ name, nonce: editorCommandNonce.current });
  }, []);

  // Reveal-in-tree: when the active file changes, expand all ancestor folders
  // so the file is visible.
  useEffect(() => {
    if (!activeFile || !activeFile.includes("/")) return;
    const ancestors: string[] = [];
    const parts = activeFile.split("/");
    for (let i = 1; i < parts.length; i++) ancestors.push(parts.slice(0, i).join("/"));
    const current = new Set(expandedDirs);
    const missing = ancestors.filter((a) => !current.has(a));
    if (missing.length === 0) return;
    file.setExpandedDirs([...current, ...missing]);
  }, [activeFile, expandedDirs, file]);

  const isFocusMode = focusSnapshot !== null;
  const toggleFocusMode = useCallback(() => {
    const snap = ui.focusSnapshot.value;
    if (snap) {
      ui.fileTreeCollapsed.value = snap.fileTree;
      ai.sidecarCollapsed.value = snap.sidecar;
      research.setShowResearch(snap.research);
      ui.focusSnapshot.value = null;
    } else {
      ui.focusSnapshot.value = {
        fileTree: ui.fileTreeCollapsed.value,
        sidecar: ai.sidecarCollapsed.value,
        research: research.showResearch,
      };
      ui.fileTreeCollapsed.value = true;
      ai.sidecarCollapsed.value = true;
      research.setShowResearch(false);
    }
  }, [ui, ai, research]);

  const handleCountsChange = useCallback((words: number, chars: number) => {
    ui.editorCounts.value = { words, chars };
  }, [ui]);

  // ── Theme ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    getShell().getPreference("episteme-theme").then((saved) => {
      const initial = (saved as "dark" | "light") ?? "dark";
      document.documentElement.dataset.theme = initial;
      themeReady.current = true;
      setTheme(initial);
    });
  }, []);

  useEffect(() => {
    if (!themeReady.current) return;
    document.documentElement.dataset.theme = theme;
    getShell().setPreference("episteme-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

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
            writingAids?: WritingAidsConfig;
          };
        }) => {
          if (data.features?.autocomplete !== undefined)
            editor.setAutocompleteEnabled(data.features.autocomplete);
          if (data.features?.autosave !== undefined)
            file.setAutosaveEnabled(data.features.autosave);
          if (data.features?.writingAids)
            setWritingAids(data.features.writingAids);
        },
      )
      .catch(() => {});
  }, [editor, file]);

  // ── /api/health on mount ────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: { workspace?: string | null; onboarding?: { required?: boolean }; aiEnabled?: boolean }) => {
        if (data.workspace) {
          if (data.onboarding?.required) setNeedsOnboarding(true);
          setAiEnabled(data.aiEnabled !== false);
        }
      })
      .catch(() => {});
  }, []);

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
              file.setWorkspaceName(parts.at(-1) ?? data.workspace);
              file.setNeedsWorkspace(false);
              file.setWorkspaceRoot(data.workspace);
              fetch("/api/chat-history")
                .then((r) => r.json())
                .then((rows: HistoryRow[]) => {
                  ai.loadHistory(rows);
                })
                .catch(() => {});
            } else {
              file.setNeedsWorkspace(true);
            }
          },
        )
        .catch(() => {});
    }
    prevAgentStateRef.current = ws.agentState;
  }, [ws.agentState, file, ai]);

  // ── "?" key opens help ──────────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.key === "F1" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        ui.settingsInitialSection.value = "help";
        ui.showSettings.value = true;
      }
      if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        ui.showSearch.value = !ui.showSearch.value;
      }
      if (e.key === "," && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        ui.settingsInitialSection.value = "style";
        ui.showSettings.value = true;
      }
    }
    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, [ui]);

  // ── Auto-open the plan panel when a plan is created ─────────────────────────

  useEffect(() => {
    if (plan) ui.showPlan.value = true;
  }, [plan !== null, ui]);

  // ── Writing-aid persistence + menu state ────────────────────────────────────

  const updateWritingAids = useCallback(
    (patch: Partial<WritingAidsConfig>) => {
      setWritingAids((prev) => {
        const next = { ...prev, ...patch };
        fetch("/api/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ features: { writingAids: next } }),
        }).catch(() => {});
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    getShell().updateMenuState({
      posHighlight: writingAids.posHighlight ?? false,
      posNoun: writingAids.posNoun ?? true,
      posVerb: writingAids.posVerb ?? true,
      posAdjective: writingAids.posAdjective ?? true,
      posAdverb: writingAids.posAdverb ?? true,
    });
  }, [
    writingAids.posHighlight,
    writingAids.posNoun,
    writingAids.posVerb,
    writingAids.posAdjective,
    writingAids.posAdverb,
  ]);

  // ── Native menu commands (Electron menu bar) ────────────────────────────────

  const writingAidsRef = useRef(writingAids);
  writingAidsRef.current = writingAids;

  useEffect(() => {
    const unsubscribe = getShell().onMenuCommand((cmd) => {
      if (cmd === "open-preferences") {
        ui.settingsInitialSection.value = "style";
        ui.showSettings.value = true;
        return;
      }
      if (cmd.startsWith("format:")) {
        dispatchEditorCommand(cmd);
        return;
      }
      const aids = writingAidsRef.current;
      if (cmd === "toggle-pos-highlight") {
        updateWritingAids({ posHighlight: !(aids.posHighlight ?? false) });
      } else if (cmd === "toggle-pos-noun") {
        updateWritingAids({ posNoun: !(aids.posNoun ?? true) });
      } else if (cmd === "toggle-pos-verb") {
        updateWritingAids({ posVerb: !(aids.posVerb ?? true) });
      } else if (cmd === "toggle-pos-adjective") {
        updateWritingAids({ posAdjective: !(aids.posAdjective ?? true) });
      } else if (cmd === "toggle-pos-adverb") {
        updateWritingAids({ posAdverb: !(aids.posAdverb ?? true) });
      }
    });
    return unsubscribe;
  }, [dispatchEditorCommand, updateWritingAids, ui]);

  // ── Search commands ─────────────────────────────────────────────────────────

  const searchCommands = useMemo<SearchCommand[]>(
    () => [
      { id: "toc", label: "Table of Contents", description: "Toggle TOC panel", action: () => { ui.showToc.value = !ui.showToc.value; } },
      { id: "research", label: "Research Panel", description: "Search arXiv, Wikipedia & workspace", action: () => research.setShowResearch((v) => !v) },
      { id: "conflicts", label: "Conflicts Panel", description: "Detect contradictions", action: () => conflictsGraph.showConflicts ? conflictsGraph.setShowConflicts(false) : conflictsGraph.handleOpenConflicts() },
      { id: "graph", label: "Knowledge Graph", description: "Visualize note connections", action: () => conflictsGraph.showGraph ? conflictsGraph.setShowGraph(false) : conflictsGraph.handleOpenGraph() },
      { id: "settings", label: "Settings", description: "Style guide & features", action: () => { ui.showSettings.value = true; } },
      { id: "help", label: "Keyboard Shortcuts", description: "View all shortcuts", action: () => { ui.settingsInitialSection.value = "help"; ui.showSettings.value = true; } },
      { id: "newfile", label: "New File", description: "Create a new note", action: () => file.createFile("untitled.md") },
      { id: "reindex", label: "Re-index Workspace", description: "Update search index", action: () => research.handleReindex() },
      { id: "save", label: "Save File", description: "Save current document", action: () => file.saveFile() },
    ],
    [ui, research, conflictsGraph, file],
  );

  // ── Sidecar / editor bridges ────────────────────────────────────────────────

  const handleSendToChat = useCallback(
    (selectionRef: string) => {
      ai.sidecarPendingInput.value = selectionRef;
      ai.sidecarCollapsed.value = false;
    },
    [ai],
  );

  const handleExplainCode = useCallback(
    (code: string, language: string) => {
      ai.explainCode(code, language);
    },
    [ai],
  );

  // ── Drag-drop ─────────────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const isExternal = e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes("text/uri-list");
    if (!isExternal) return;
    e.preventDefault();
    ui.isDragOver.value = true;
  }, [ui]);

  const handleDragLeave = useCallback(() => { ui.isDragOver.value = false; }, [ui]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      ui.isDragOver.value = false;
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

  // ── Cross-cutting WebSocket subscriptions (non-AI) ──────────────────────────
  //
  // AI-message subscriptions live in AIProvider. The handlers below own state
  // that belongs to other hooks (editor flags, research/conflicts loading
  // flags, index progress) so they stay here for now.

  useEffect(() => {
    const unsubFileContent = ws.subscribe("file_content", () => {
      editor.setGhostText("");
      ui.dismissedLargeFile.value = false;
    });
    const unsubFileCreated = ws.subscribe("file_created", () => {
      editor.setGhostText("");
    });
    const unsubIndex = ws.subscribe("index_progress", (msg) => {
      if (msg.total === 0 || msg.indexed >= msg.total) ui.indexProgress.value = null;
      else ui.indexProgress.value = { indexed: msg.indexed, total: msg.total };
    });
    // Reset loading flags on error. The error message itself is pushed into
    // the chat stream by AIProvider (a separate subscriber on the same event).
    const unsubErrorResets = ws.subscribe("error", () => {
      editor.setIsGeneratingMetadata(false);
      editor.setIsTocGenerating(false);
      research.setIsSearching(false);
      research.setIsDetectingGaps(false);
      conflictsGraph.setIsScanning(false);
      conflictsGraph.setIsLoadingGraph(false);
    });
    return () => {
      unsubFileContent();
      unsubFileCreated();
      unsubIndex();
      unsubErrorResets();
    };
  }, [ws.subscribe, editor, research, conflictsGraph, ui]);

  const charCount = editorContent.length;
  const showLargeFileWarning = charCount > 50_000 && !dismissedLargeFile;

  const posHighlightOptions = useMemo(() => ({
    enabled: writingAids.posHighlight ?? false,
    noun: writingAids.posNoun ?? true,
    verb: writingAids.posVerb ?? true,
    adjective: writingAids.posAdjective ?? true,
    adverb: writingAids.posAdverb ?? true,
  }), [writingAids]);
  const focusModeOptions = useMemo(() => ({
    enabled: writingAids.focusMode ?? false,
    level: writingAids.focusLevel ?? "sentence" as const,
  }), [writingAids]);
  const styleCheckOptions = useMemo(() => ({
    enabled: writingAids.styleCheck ?? false,
    filler: writingAids.styleFiller ?? true,
    cliche: writingAids.styleCliche ?? true,
    redundancy: writingAids.styleRedundancy ?? true,
    strikethrough: writingAids.styleStrikethrough ?? false,
    tintText: writingAids.styleTintText ?? false,
  }), [writingAids]);
  const punctuationHighlightOn = writingAids.punctuationHighlight ?? false;

  // Apply user-picked highlight colors as CSS variables, clamped per theme so
  // the chosen hue stays legible on both backgrounds.
  useEffect(() => {
    const colors = writingAids.colors ?? {};
    const root = document.documentElement;
    for (const key of Object.keys(HIGHLIGHT_CSS_VARS) as HighlightColorKey[]) {
      const varName = HIGHLIGHT_CSS_VARS[key];
      const picked = colors[key];
      if (picked) root.style.setProperty(varName, themedColor(picked, theme));
      else root.style.removeProperty(varName);
    }
  }, [writingAids.colors, theme]);

  if (needsWorkspace) {
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
            disabled={isPickingWorkspace}
            onClick={file.handleOpenWorkspace}
          >
            {isPickingWorkspace ? "Opening…" : "Open Folder"}
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
          {workspaceName}
        </span>
        <button
          className="header-search-trigger"
          onClick={() => { ui.showSearch.value = true; }}
          title="Unified search (⌘K)"
        >
          <Search size={13} />
          <span>Search…</span>
          <kbd>⌘P</kbd>
        </button>
        <div className="app-header-actions">
          {aiEnabled && (
            <button
              className={`header-research-btn${!sidecarCollapsed ? " active" : ""}`}
              title={sidecarCollapsed ? "Show AI" : "Hide AI"}
              onClick={() => { ai.sidecarCollapsed.value = !ai.sidecarCollapsed.value; }}
            >
              <Sparkles size={16} />
            </button>
          )}
          <button
            className={`header-research-btn${isFocusMode ? " active" : ""}`}
            title={isFocusMode ? "Exit focus mode" : "Focus mode (hide side panels)"}
            onClick={toggleFocusMode}
          >
            <Focus size={16} />
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
        onClose={() => { ui.showSearch.value = false; }}
        workspaceFiles={workspaceFiles}
        onFileSelect={(path) => { file.openFile(path); ui.showSearch.value = false; }}
        onResearchSearch={(q) => {
          research.handleSearch(q);
          research.setShowResearch(true);
          ui.showSearch.value = false;
        }}
        researchResults={research.searchResults}
        isResearching={research.isSearching}
        commands={searchCommands}
      />
      {showSettings && (
        <SettingsPanel
          onClose={() => { ui.showSettings.value = false; }}
          onAutocompleteEnabledChange={editor.setAutocompleteEnabled}
          onAutosaveEnabledChange={file.setAutosaveEnabled}
          onWritingAidsChange={setWritingAids}
          initialSection={settingsInitialSection}
        />
      )}
      <PermissionDialog wsRef={ws.wsRef} subscribe={ws.subscribe} />
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
          onDismiss={() => { ui.dismissedLargeFile.value = true; }}
        />
      )}

      {/* Offline notice — only when AI is supposed to be running */}
      {aiEnabled && ws.agentState === "disconnected" && (
        <div className="offline-banner">AI unavailable — reconnecting…</div>
      )}

      {/* LLM provider down — distinct from WebSocket disconnect. */}
      {aiEnabled
        && ws.agentState !== "disconnected"
        && providerStatus
        && !providerStatus.reachable
        && !providerBannerDismissed && (
        <div className="provider-offline-banner">
          <span>
            <strong>Ollama unreachable</strong> at {providerStatus.endpoint} —
            chat, AI fill, diagrams, and other AI features will not work until
            it&rsquo;s running. Start it with <code>ollama serve</code>.
          </span>
          <button
            className="large-file-banner-btn"
            onClick={() => { ai.providerBannerDismissed.value = true; }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Body */}
      <div className="app-body">
        {!isFocusMode && (
          <nav className="activity-rail" aria-label="Workspace views">
            <div className="rail-group">
              <button
                className={`rail-btn${!fileTreeCollapsed ? " active" : ""}`}
                title={fileTreeCollapsed ? "Show files" : "Hide files"}
                onClick={() => { ui.fileTreeCollapsed.value = !ui.fileTreeCollapsed.value; }}
              >
                <PanelLeft size={18} />
              </button>
              <button
                className={`rail-btn${showToc ? " active" : ""}`}
                title="Table of contents"
                onClick={() => { ui.showToc.value = !ui.showToc.value; }}
              >
                <AlignLeft size={18} />
              </button>
              <button
                className={`rail-btn${research.showResearch ? " active" : ""}`}
                title="Research panel"
                onClick={() => research.setShowResearch((v) => !v)}
              >
                <Search size={18} />
              </button>
              <button
                className={`rail-btn${conflictsGraph.showGraph ? " active" : ""}`}
                title="Knowledge graph"
                onClick={() =>
                  conflictsGraph.showGraph
                    ? conflictsGraph.setShowGraph(false)
                    : conflictsGraph.handleOpenGraph()
                }
              >
                <Network size={18} />
              </button>
              <button
                className={`rail-btn${showPlan ? " active" : ""}`}
                title="Plan panel"
                onClick={() => { ui.showPlan.value = !ui.showPlan.value; }}
              >
                <ClipboardList size={18} />
              </button>
            </div>
            <div className="rail-group">
              <button
                className="rail-btn"
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                onClick={toggleTheme}
              >
                {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button
                className="rail-btn"
                title="Settings"
                onClick={() => { ui.settingsInitialSection.value = "style"; ui.showSettings.value = true; }}
              >
                <Settings size={18} />
              </button>
            </div>
          </nav>
        )}
        <FileTree />

        <div
          style={{
            flex: 1,
            minWidth: 320,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {externalContent !== null && (
            <ExternalChangeBanner
              onReload={() => file.resolveExternalConflict("reload")}
              onKeep={() => file.resolveExternalConflict("keep")}
            />
          )}
          <Editor
            content={editorContent}
            onUpdate={(md) => file.setEditorContent(md)}
            onImagePaste={voice.handleImagePaste}
            onExplainCode={handleExplainCode}
            isRecording={voice.isRecording}
            onToggleRecording={voice.handleToggleRecording}
            onSendToChat={handleSendToChat}
            onNavigate={file.openFile}
            onCreateFile={file.createFile}
            workspaceFiles={workspaceFiles}
            onCountsChange={handleCountsChange}
            editorMode={editorMode}
            currentFilePath={activeFile ?? ""}
            posHighlight={posHighlightOptions}
            punctuationHighlight={punctuationHighlightOn}
            focusMode={focusModeOptions}
            styleCheck={styleCheckOptions}
            command={editorCommand}
          />

          {/* Status bar */}
          <div className="status-bar">
            {activeFile ? (
              <>
                <span className="status-bar-file">
                  {activeFile.split("/").at(-1)}
                </span>
                {isDirty && (
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
            {activeFile && (
              <label className="settings-toggle" title="Toggle Markdown / Formatted view">
                <input
                  type="checkbox"
                  checked={editorMode === "markdown"}
                  onChange={() => { ui.editorMode.value = editorMode === "formatted" ? "markdown" : "formatted"; }}
                />
                <span className="settings-toggle-track" />
                <span className="status-bar-mode-label">Markdown</span>
              </label>
            )}
            {activeFile && (
              <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                {editorCounts.words.toLocaleString()} words ·{" "}
                {editorCounts.chars.toLocaleString()} chars
              </span>
            )}
            {activeFile && isDirty && (
              <button
                className="status-bar-save"
                onClick={file.saveFile}
                title="Save (⌘S)"
              >
                Save
              </button>
            )}
            {activeFile && !isDirty && (
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
            onClose: () => { ui.showToc.value = false; },
            content: <TocPanel />,
          });
          if (research.showResearch) panels.push({
            id: "research",
            label: "Research",
            defaultWidth: 320,
            onClose: () => research.setShowResearch(false),
            content: (
              <ResearchPanel
                onSearch={research.handleSearch}
                onDetectGaps={research.handleDetectGaps}
                onIngest={research.handleIngestFromSearch}
                onReindex={research.handleReindex}
                onSendToAgent={(text) => {
                  ai.sendToAgent(text);
                  ai.sidecarCollapsed.value = false;
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
            onClose: () => { ui.showPlan.value = false; },
            content: <PlanPanel />,
          });
          if (conflictsGraph.showGraph) panels.push({
            id: "graph",
            label: "Graph",
            defaultWidth: 420,
            onClose: () => conflictsGraph.setShowGraph(false),
            content: (
              <KnowledgeGraph
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
        {aiEnabled && (
          <AISidecar
            workspaceFiles={workspaceFiles}
            activeFile={activeFile}
            onNavigate={file.openFile}
          />
        )}
      </div>
      <OnboardingModal
        open={needsOnboarding}
        onComplete={({ aiEnabled: enabled }) => {
          setAiEnabled(enabled);
          setNeedsOnboarding(false);
        }}
      />
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
