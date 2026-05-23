import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "./components/editor/Editor.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { TocPanel } from "./components/TocPanel.tsx";
import { AISidecar, type SidecarMessage } from "./components/AISidecar.tsx";
import type { EpistemePlanStepType } from "./planning/types.ts";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
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
import { useWebSocket } from "./hooks/useWebSocket.ts";
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

const PLUGIN_LABELS: Record<string, string> = {
  Diagram: "Diagram",
  Citation: "Citation",
  Contradiction: "Contradiction scanning",
  StyleGuide: "Style guide",
};
function pluginLabel(name: string): string {
  return PLUGIN_LABELS[name] ?? name;
}

function App() {
  const [messages, setMessages] = useState<SidecarMessage[]>([]);
  const [sidecarCollapsed, setSidecarCollapsed] = useState(() => {
    try { return localStorage.getItem("episteme:sidecar-collapsed") === "1"; } catch { return false; }
  });
  const [fileTreeCollapsed, setFileTreeCollapsed] = useState(() => {
    try { return localStorage.getItem("episteme:filetree-collapsed") === "1"; } catch { return false; }
  });
  const [focusSnapshot, setFocusSnapshot] = useState<
    { fileTree: boolean; sidecar: boolean; research: boolean } | null
  >(null);
  // Tracks which plugin activation events have been announced this session
  // so the inline sidecar notice only fires once per plugin.
  const announcedPluginsRef = useRef<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const themeReady = useRef(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<"style" | "models" | "help">("style");
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
  const [sidecarPendingInput, setSidecarPendingInput] = useState("");
  const [writingAids, setWritingAids] = useState<WritingAidsConfig>({});
  const [editorCommand, setEditorCommand] = useState<{ name: string; nonce: number } | null>(null);
  const editorCommandNonce = useRef(0);
  const dispatchEditorCommand = useCallback((name: string) => {
    editorCommandNonce.current += 1;
    setEditorCommand({ name, nonce: editorCommandNonce.current });
  }, []);

  const ws = useWebSocket();
  const planning = usePlanning(ws.wsRef, ws.subscribe);

  const planRef = useRef(planning.plan);
  useEffect(() => { planRef.current = planning.plan; }, [planning.plan]);

  // Auto-open the plan panel when a plan is created or already active on connect
  useEffect(() => {
    if (planning.plan) setShowPlan(true);
  }, [planning.plan !== null]);

  const fileManager = useFileManager(ws.wsRef, ws.agentState, ws.subscribe);
  const fileTreeState = useFileTreeState(ws.wsRef, ws.agentState, ws.subscribe, workspaceRoot);

  // Reveal-in-tree: when the active file changes, expand all ancestor folders
  // so the file is visible. Expanding an already-expanded folder is a no-op,
  // so this is safe regardless of how the file was opened.
  useEffect(() => {
    const path = fileManager.activeFile;
    if (!path || !path.includes("/")) return;
    const ancestors: string[] = [];
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) ancestors.push(parts.slice(0, i).join("/"));
    const current = new Set(fileTreeState.expandedDirs);
    const missing = ancestors.filter((a) => !current.has(a));
    if (missing.length === 0) return;
    fileTreeState.setExpandedDirs([...current, ...missing]);
  }, [fileManager.activeFile, fileTreeState]);
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

  useEffect(() => {
    try { localStorage.setItem("episteme:sidecar-collapsed", sidecarCollapsed ? "1" : "0"); } catch {}
  }, [sidecarCollapsed]);
  useEffect(() => {
    try { localStorage.setItem("episteme:filetree-collapsed", fileTreeCollapsed ? "1" : "0"); } catch {}
  }, [fileTreeCollapsed]);

  const isFocusMode = focusSnapshot !== null;
  const toggleFocusMode = useCallback(() => {
    if (focusSnapshot) {
      setFileTreeCollapsed(focusSnapshot.fileTree);
      setSidecarCollapsed(focusSnapshot.sidecar);
      research.setShowResearch(focusSnapshot.research);
      setFocusSnapshot(null);
    } else {
      setFocusSnapshot({
        fileTree: fileTreeCollapsed,
        sidecar: sidecarCollapsed,
        research: research.showResearch,
      });
      setFileTreeCollapsed(true);
      setSidecarCollapsed(true);
      research.setShowResearch(false);
    }
  }, [focusSnapshot, fileTreeCollapsed, sidecarCollapsed, research]);

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
            lint?: boolean;
            writingAids?: WritingAidsConfig;
          };
        }) => {
          if (data.features?.autocomplete !== undefined)
            editorFeatures.setAutocompleteEnabled(data.features.autocomplete);
          if (data.features?.autosave !== undefined)
            fileManager.setAutosaveEnabled(data.features.autosave);
          if (data.features?.lint !== undefined)
            editorFeatures.setLintEnabled(data.features.lint);
          if (data.features?.writingAids)
            setWritingAids(data.features.writingAids);
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
                    rows: Array<
                      | { id: number; role: "user" | "assistant"; text: string }
                      | {
                          id: number;
                          role: "tool";
                          name: string;
                          status: "done" | "error";
                          error?: string;
                        }
                      | {
                          id: number;
                          role: "plan_step";
                          planId: string;
                          stepId: string;
                          stepTitle: string;
                          stepType: string;
                          state: "complete" | "failed";
                          summary?: string;
                          error?: string;
                        }
                    >,
                  ) => {
                    setMessages(
                      rows.map((r): SidecarMessage => {
                        if (r.role === "tool") {
                          return { role: "tool", name: r.name, status: r.status, error: r.error };
                        }
                        if (r.role === "plan_step") {
                          return {
                            role: "plan_step",
                            planId: r.planId,
                            stepId: r.stepId,
                            stepTitle: r.stepTitle,
                            stepType: r.stepType as EpistemePlanStepType,
                            state: r.state,
                            summary: r.summary,
                            error: r.error,
                          };
                        }
                        return { role: r.role, text: r.text, id: r.id };
                      }),
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
        setSettingsInitialSection("help");
        setShowSettings(true);
      }
      if (e.key === "p" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
      if (e.key === "," && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSettingsInitialSection("style");
        setShowSettings(true);
      }
    }
    window.addEventListener("keydown", handleKey, { capture: true });
    return () => window.removeEventListener("keydown", handleKey, { capture: true });
  }, []);

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
        setSettingsInitialSection("style");
        setShowSettings(true);
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
  }, [dispatchEditorCommand, updateWritingAids]);

  // ── AI sidecar wrappers ─────────────────────────────────────────────────────

  const resolveMentions = useCallback(async (text: string): Promise<string> => {
    const mentionPattern = /@([\w\-./ ]+\.md)/g;
    const mentions = [...text.matchAll(mentionPattern)].map((m) => m[1]!.trim());
    if (mentions.length === 0) return text;

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
    return blocks ? `${blocks}\n\n---\n${text}` : text;
  }, []);

  const sendToAgent = useCallback(
    (text: string) => {
      if (ws.agentState === "disconnected") return;
      ws.sendToAgent(text);
      setMessages((prev) => [...prev, { role: "user", text }]);
    },
    [ws],
  );

  const handleSidecarPlanRequest = useCallback(
    async (goal: string, approvalMode: "all" | "per_step") => {
      const resolvedGoal = await resolveMentions(goal);
      planning.requestPlan(resolvedGoal, approvalMode);
      setShowPlan(true);
      setSidecarCollapsed(false);
    },
    [planning, resolveMentions],
  );

  const handleSidecarPlanRequestFromDocument = useCallback(
    async (path: string, goal: string, approvalMode: "all" | "per_step") => {
      const resolvedGoal = await resolveMentions(goal);
      planning.requestPlanFromDocument(path, resolvedGoal, approvalMode);
      setShowPlan(true);
      setSidecarCollapsed(false);
    },
    [planning, resolveMentions],
  );

  const handleSidecarPlanFollowUp = useCallback(
    async (goal: string, priorPlanId: string, approvalMode: "all" | "per_step") => {
      const resolvedGoal = await resolveMentions(goal);
      planning.resetPlan();
      planning.requestPlan(resolvedGoal, approvalMode, priorPlanId);
      setShowPlan(true);
      setSidecarCollapsed(false);
    },
    [planning, resolveMentions],
  );

  const interrupt = useCallback(() => {
    ws.interrupt();
  }, [ws]);

  const handleRegenerate = useCallback((assistantIndex: number) => {
    const before = messages.slice(0, assistantIndex);
    let lastUserAt = -1;
    for (let i = before.length - 1; i >= 0; i--) {
      if (before[i]!.role === "user") { lastUserAt = i; break; }
    }
    if (lastUserAt === -1) return;
    const userMsg = before[lastUserAt];
    if (!userMsg || userMsg.role !== "user") return;
    setMessages(before.slice(0, lastUserAt));
    sendToAgent(userMsg.text);
  }, [messages, sendToAgent]);

  const [planSeedGoal, setPlanSeedGoal] = useState("");

  const handleSendToPlan = useCallback((text: string) => {
    setPlanSeedGoal(text);
    setShowPlan(true);
  }, []);

  const onDeleteMessage = useCallback((index: number) => {
    setMessages((prev) => {
      const msg = prev[index];
      if (msg && (msg.role === "user" || msg.role === "assistant") && msg.id !== undefined) {
        fetch(`/api/chat-history/${msg.id}`, { method: "DELETE" }).catch(() => {});
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const onRemoveMention = useCallback((index: number, path: string) => {
    setMessages((prev) => {
      const msg = prev[index];
      if (!msg || msg.role !== "user") return prev;
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const newText = msg.text.replace(new RegExp(`\\s*@${escaped}`, "g"), "").trim();
      if (msg.id !== undefined) {
        fetch(`/api/chat-history/${msg.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: newText }),
        }).catch(() => {});
      }
      if (!newText) return prev.filter((_, i) => i !== index);
      const next = [...prev];
      next[index] = { ...msg, text: newText };
      return next;
    });
  }, []);

  const searchCommands = useMemo<SearchCommand[]>(
    () => [
      { id: "toc", label: "Table of Contents", description: "Toggle TOC panel", action: () => setShowToc((v) => !v) },
      { id: "research", label: "Research Panel", description: "Search arXiv, Wikipedia & workspace", action: () => research.setShowResearch((v) => !v) },
      { id: "conflicts", label: "Conflicts Panel", description: "Detect contradictions", action: () => conflictsGraph.showConflicts ? conflictsGraph.setShowConflicts(false) : conflictsGraph.handleOpenConflicts() },
      { id: "graph", label: "Knowledge Graph", description: "Visualize note connections", action: () => conflictsGraph.showGraph ? conflictsGraph.setShowGraph(false) : conflictsGraph.handleOpenGraph() },
      { id: "settings", label: "Settings", description: "Style guide & features", action: () => setShowSettings(true) },
      { id: "help", label: "Keyboard Shortcuts", description: "View all shortcuts", action: () => { setSettingsInitialSection("help"); setShowSettings(true); } },
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

  const handleSendToChat = useCallback((selectionRef: string) => {
    setSidecarPendingInput(selectionRef);
    setSidecarCollapsed(false);
  }, []);

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
            next[i] = {
              role: "tool",
              name: msg.name,
              status: msg.error ? "error" : "done",
              error: msg.error,
            };
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
    const unsubStepStarted = ws.subscribe("plan_step_started", (msg) => {
      const plan = planRef.current;
      const step = plan?.steps.find((s) => s.id === msg.stepId);
      if (!step) return;
      setMessages((prev) => [
        ...prev,
        {
          role: "plan_step",
          planId: msg.planId,
          stepId: msg.stepId,
          stepTitle: step.title,
          stepType: step.type,
          state: "running",
        },
      ]);
    });
    const unsubStepCompleted = ws.subscribe("plan_step_completed", (msg) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "plan_step" && m.stepId === msg.stepId
            ? { ...m, state: "complete", summary: msg.summary }
            : m,
        ),
      );
    });
    const unsubStepFailed = ws.subscribe("plan_step_failed", (msg) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "plan_step" && m.stepId === msg.stepId
            ? { ...m, state: "failed", error: msg.error }
            : m,
        ),
      );
    });
    const unsubAgentMode = ws.subscribe("agent_mode_changed", (msg) => {
      const announced = announcedPluginsRef.current;
      const newlyActive = msg.activePlugins.filter((name) => !announced.has(name));
      if (newlyActive.length === 0) return;
      for (const name of newlyActive) announced.add(name);
      setMessages((prev) => [
        ...prev,
        ...newlyActive.map((name) => ({
          role: "system_event" as const,
          plugin: name,
          text: `${pluginLabel(name)} tools now available`,
        })),
      ]);
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
      unsubStepStarted();
      unsubStepCompleted();
      unsubStepFailed();
      unsubAgentMode();
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
          <kbd>⌘P</kbd>
        </button>
        <div className="app-header-actions">
          <button
            className={`header-research-btn${!sidecarCollapsed ? " active" : ""}`}
            title={sidecarCollapsed ? "Show AI" : "Hide AI"}
            onClick={() => setSidecarCollapsed((c) => !c)}
          >
            <Sparkles size={16} />
          </button>
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
          onDismiss={() => setDismissedLargeFile(true)}
        />
      )}

      {/* Offline notice */}
      {ws.agentState === "disconnected" && (
        <div className="offline-banner">AI unavailable — reconnecting…</div>
      )}

      {/* Body */}
      <div className="app-body">
        {!isFocusMode && (
          <nav className="activity-rail" aria-label="Workspace views">
            <div className="rail-group">
              <button
                className={`rail-btn${!fileTreeCollapsed ? " active" : ""}`}
                title={fileTreeCollapsed ? "Show files" : "Hide files"}
                onClick={() => setFileTreeCollapsed((c) => !c)}
              >
                <PanelLeft size={18} />
              </button>
              <button
                className={`rail-btn${showToc ? " active" : ""}`}
                title="Table of contents"
                onClick={() => setShowToc((v) => !v)}
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
                onClick={() => setShowPlan((v) => !v)}
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
                onClick={() => { setSettingsInitialSection("style"); setShowSettings(true); }}
              >
                <Settings size={18} />
              </button>
            </div>
          </nav>
        )}
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
          onDeleteFile={fileManager.deleteFile}
          onOpenInFinder={fileManager.openInFinder}
          workspaceRoot={workspaceRoot}
          initialExpandedDirs={fileTreeState.expandedDirs}
          onExpandedChange={fileTreeState.setExpandedDirs}
          collapsed={fileTreeCollapsed}
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
            toneReplacement={editorFeatures.toneReplacement}
            summarizeResult={editorFeatures.summarizeResult}
            onToneApplied={() => editorFeatures.setToneReplacement(null)}
            onSummarizeApplied={() => editorFeatures.setSummarizeResult(null)}
            lintIssues={editorFeatures.lintIssues}
            onMetadataRequest={editorFeatures.handleMetadataRequest}
            isGeneratingMetadata={editorFeatures.isGeneratingMetadata}
            metadataResult={editorFeatures.metadataResult}
            onMetadataApplied={() => editorFeatures.setMetadataResult(null)}
            tableResult={editorFeatures.tableResult}
            onTableApplied={() => editorFeatures.setTableResult(null)}
            onDiagramRequest={editorFeatures.handleDiagramRequest}
            diagramResult={editorFeatures.diagramResult}
            onDiagramApplied={() => editorFeatures.setDiagramResult(null)}
            onAIFillRequest={editorFeatures.handleAIFillRequest}
            aiFillResult={editorFeatures.aiFillResult}
            onAIFillApplied={() => editorFeatures.setAIFillResult(null)}
            onImagePaste={voice.handleImagePaste}
            onExplainCode={handleExplainCode}
            isRecording={voice.isRecording}
            onToggleRecording={voice.handleToggleRecording}
            onSendToChat={handleSendToChat}
            onNavigate={fileManager.openFile}
            onCreateFile={fileManager.createFile}
            workspaceFiles={fileManager.workspaceFiles}
            onCountsChange={handleCountsChange}
            editorMode={editorMode}
            currentFilePath={fileManager.activeFile ?? ""}
            posHighlight={posHighlightOptions}
            punctuationHighlight={punctuationHighlightOn}
            focusMode={focusModeOptions}
            styleCheck={styleCheckOptions}
            command={editorCommand}
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
                seedGoal={planSeedGoal}
                onSeedConsumed={() => setPlanSeedGoal("")}
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
          onSend={sendToAgent}
          onInterrupt={interrupt}
          onNavigate={fileManager.openFile}
          workspaceFiles={fileManager.workspaceFiles}
          onRegenerate={handleRegenerate}
          onSendToPlan={handleSendToPlan}
          onDeleteMessage={onDeleteMessage}
          onRemoveMention={onRemoveMention}
          pendingInput={sidecarPendingInput}
          onPendingInputConsumed={() => setSidecarPendingInput("")}
          activeFile={fileManager.activeFile}
          onPlanRequest={handleSidecarPlanRequest}
          onPlanRequestFromDocument={handleSidecarPlanRequestFromDocument}
          activePlan={planning.plan ? { id: planning.plan.id, goal: planning.plan.goal } : null}
          onPlanFollowUp={handleSidecarPlanFollowUp}
        />
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
