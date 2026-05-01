import { createRoot } from "react-dom/client";
import { useState, useEffect, useRef, useCallback } from "react";
import { Editor } from "./components/Editor.tsx";
import { FileTree } from "./components/FileTree.tsx";
import { AISidecar, type SidecarMessage } from "./components/AISidecar.tsx";
import { SettingsPanel } from "./components/SettingsPanel.tsx";
import { ResearchPanel } from "./components/ResearchPanel.tsx";
import type { UnifiedSearchResponse } from "./components/ResearchPanel.tsx";
import { ConflictsPanel } from "./components/ConflictsPanel.tsx";
import type { ContradictionRecord } from "./components/ConflictsPanel.tsx";
import { KnowledgeGraph } from "./components/KnowledgeGraph.tsx";
import type { GraphData } from "./components/KnowledgeGraph.tsx";
import { ExportPanel } from "./components/ExportPanel.tsx";
import type { ExportFormat } from "./features/export.ts";
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
  | { type: "file_created"; path: string }
  | { type: "file_renamed"; oldPath: string; newPath: string }
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
  | { type: "search_result"; results: UnifiedSearchResponse }
  | { type: "detect_gaps_result"; markdown: string }
  | { type: "contradictions_data"; contradictions: ContradictionRecord[] }
  | { type: "graph_data"; data: GraphData }
  | { type: "check_citations_result"; result: { valid: string[]; broken: string[] } }
  | { type: "format_citation_result"; bibtex: string }
  | { type: "alt_text"; text: string; mimeType: string; base64: string }
  | { type: "explain_code_result"; explanation: string }
  | { type: "transcript"; text: string }
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

// ── Keyboard shortcut help panel ──────────────────────────────────────────────

function HelpPanel({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { key: "⌘S", desc: "Save file" },
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
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <table className="help-table">
          <tbody>
            {shortcuts.map(({ key, desc }) => (
              <tr key={key} className="help-row">
                <td className="help-key"><kbd>{key}</kbd></td>
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

function LargeFileBanner({ charCount, onDismiss }: { charCount: number; onDismiss: () => void }) {
  return (
    <div className="large-file-banner">
      <span>
        This document is {(charCount / 1000).toFixed(0)}k characters — AI features may be slow or truncated.
      </span>
      <button className="autolink-btn dismiss" onClick={onDismiss}>Dismiss</button>
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

  // Research panel
  const [showResearch, setShowResearch] = useState(false);
  const [searchResults, setSearchResults] = useState<UnifiedSearchResponse | null>(null);
  const [gapReport, setGapReport] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isDetectingGaps, setIsDetectingGaps] = useState(false);

  // Conflicts panel
  const [showConflicts, setShowConflicts] = useState(false);
  const [contradictions, setContradictions] = useState<ContradictionRecord[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  // Knowledge graph
  const [showGraph, setShowGraph] = useState(false);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);

  // Phase 6: Export
  const [showExport, setShowExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pandocAvailable, setPandocAvailable] = useState(false);

  // Phase 6: Explain code — result inserted into sidecar messages
  // (no extra state needed, explanation goes to messages array)

  // Phase 6: Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Phase 6: Pending image alt-text insertion (stores base64 + mimeType until inserted)
  const pendingAltTextRef = useRef<{ base64: string; mimeType: string } | null>(null);
  const [altTextInsert, setAltTextInsert] = useState<string | null>(null);

  // Polish: large file warning
  const [dismissedLargeFile, setDismissedLargeFile] = useState(false);

  // Help panel
  const [showHelp, setShowHelp] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;

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
          .then((data: { workspace?: string; pandocAvailable?: boolean }) => {
            if (data.workspace) {
              const parts = data.workspace.split("/");
              setWorkspaceName(parts.at(-1) ?? data.workspace);
            }
            setPandocAvailable(data.pandocAvailable ?? false);
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
          case "tool_call":
            setMessages((prev) => [
              ...prev,
              { role: "tool", name: msg.name, status: "calling" },
            ]);
            break;
          case "tool_result":
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
            });
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
            setDismissedLargeFile(false);
            break;
          case "file_created":
            setActiveFile(msg.path);
            setEditorContent("");
            setSavedContent("");
            setIsDirty(false);
            setGhostText("");
            setLintIssues([]);
            setAutolinkSuggestions([]);
            break;
          case "file_renamed":
            if (activeFileRef.current === msg.oldPath) setActiveFile(msg.newPath);
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
          case "search_result":
            setSearchResults(msg.results);
            setIsSearching(false);
            break;
          case "detect_gaps_result":
            setGapReport(msg.markdown);
            setIsDetectingGaps(false);
            break;
          case "contradictions_data":
            setContradictions(msg.contradictions);
            setIsScanning(false);
            break;
          case "graph_data":
            setGraphData(msg.data);
            setIsLoadingGraph(false);
            break;
          case "check_citations_result":
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                text: `Citations: ${msg.result.valid.length} valid, ${msg.result.broken.length} broken.${msg.result.broken.length > 0 ? "\n\nBroken:\n" + msg.result.broken.join("\n") : ""}`,
              },
            ]);
            break;
          case "format_citation_result":
            setMessages((prev) => [...prev, { role: "assistant", text: `\`\`\`bibtex\n${msg.bibtex}\n\`\`\`` }]);
            break;
          case "alt_text": {
            // Store image data, trigger insertion via state
            pendingAltTextRef.current = { base64: msg.base64, mimeType: msg.mimeType };
            setAltTextInsert(`![${msg.text}](data:${msg.mimeType};base64,${msg.base64})`);
            break;
          }
          case "explain_code_result":
            setMessages((prev) => [
              ...prev,
              { role: "assistant", text: `**Code explanation:**\n\n${msg.explanation}` },
            ]);
            // Open sidecar if collapsed
            setSidecarCollapsed(false);
            break;
          case "transcript": {
            // Insert transcribed text into editor at current end
            setEditorContent((prev) => {
              const sep = prev.trim() ? "\n\n" : "";
              return prev + sep + msg.text;
            });
            break;
          }
          case "error":
            setMessages((prev) => [
              ...prev,
              { role: "assistant", text: `[Error] ${msg.message}` },
            ]);
            setIsGeneratingMetadata(false);
            setIsTocGenerating(false);
            setIsSearching(false);
            setIsDetectingGaps(false);
            setIsScanning(false);
            setIsLoadingGraph(false);
            setIsExporting(false);
            break;
        }
      };
    }

    connect();
    return () => wsRef.current?.close();
  }, []);

  // Insert alt text markdown when server responds
  useEffect(() => {
    if (!altTextInsert) return;
    setEditorContent((prev) => {
      const sep = prev.trim() ? "\n\n" : "";
      return prev + sep + altTextInsert;
    });
    setAltTextInsert(null);
  }, [altTextInsert]);

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

  const createFile = useCallback((path: string) => {
    wsRef.current?.send(JSON.stringify({ type: "file_create", path }));
  }, []);

  const renameFile = useCallback((oldPath: string, newPath: string) => {
    wsRef.current?.send(JSON.stringify({ type: "file_rename", oldPath, newPath }));
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
      // ? key opens help (only when not typing in an input/textarea)
      if (e.key === "?" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        setShowHelp((v) => !v);
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
    // Warn if large file before sending to autocomplete
    if (context.length > 50_000) return;
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

  // ── Research ──────────────────────────────────────────────────────────────

  const handleSearch = useCallback((query: string) => {
    if (!wsRef.current || agentState === "disconnected") return;
    setIsSearching(true);
    setSearchResults(null);
    wsRef.current.send(JSON.stringify({ type: "search_request", query }));
  }, [agentState]);

  const handleDetectGaps = useCallback((topic: string) => {
    if (!wsRef.current || agentState === "disconnected") return;
    setIsDetectingGaps(true);
    setGapReport(null);
    wsRef.current.send(JSON.stringify({ type: "detect_gaps_request", topic }));
  }, [agentState]);

  const handleIngestFromSearch = useCallback((url: string) => {
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "ingest_url", url }));
    setMessages((prev) => [...prev, { role: "assistant", text: `Ingesting: ${url}` }]);
  }, [agentState]);

  const handleReindex = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "send", text: "Please run the index_workspace tool to re-index all workspace files." }));
  }, [agentState]);

  // ── Conflicts ─────────────────────────────────────────────────────────────

  const handleOpenConflicts = useCallback(() => {
    setShowConflicts(true);
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "contradictions_request" }));
  }, [agentState]);

  const handleContradictionScan = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected" || isScanning) return;
    setIsScanning(true);
    wsRef.current.send(JSON.stringify({ type: "contradiction_scan_request" }));
  }, [agentState, isScanning]);

  // ── Knowledge Graph ───────────────────────────────────────────────────────

  const handleOpenGraph = useCallback(() => {
    setShowGraph(true);
    setIsLoadingGraph(true);
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "graph_request" }));
  }, [agentState]);

  const handleRefreshGraph = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected") return;
    setIsLoadingGraph(true);
    wsRef.current.send(JSON.stringify({ type: "graph_request" }));
  }, [agentState]);

  const handleGraphNodeClick = useCallback((file: string) => {
    openFile(file);
  }, [openFile]);

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
        } else if (file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(",")[1] ?? "";
            wsRef.current?.send(JSON.stringify({
              type: "analyze_image",
              base64,
              mimeType: file.type,
              filename: file.name,
            }));
          };
          reader.readAsDataURL(file);
        }
      }
    },
    [agentState],
  );

  // ── Ask AI about selection ────────────────────────────────────────────────────

  const handleAskAboutSelection = useCallback((text: string) => {
    if (!wsRef.current) return;
    const msg = `[Selected text]\n\n${text}\n\n---\nWhat can you tell me about this?`;
    wsRef.current.send(JSON.stringify({ type: "send", text: msg }));
    setMessages((prev) => [...prev, { role: "user", text: msg }]);
    setSidecarCollapsed(false);
  }, []);

  // ── Phase 6: Image paste ──────────────────────────────────────────────────────

  const handleImagePaste = useCallback(
    (base64: string, mimeType: string, filename: string) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "analyze_image", base64, mimeType, filename }));
    },
    [agentState],
  );

  // ── Phase 6: Explain code ─────────────────────────────────────────────────────

  const handleExplainCode = useCallback(
    (code: string, language: string) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "explain_code", code, language }));
      setMessages((prev) => [...prev, { role: "user", text: `Explain ${language} code block` }]);
      setSidecarCollapsed(false);
    },
    [agentState],
  );

  // ── Phase 6: Voice recording ──────────────────────────────────────────────────

  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const audioBase64 = dataUrl.split(",")[1] ?? "";
          wsRef.current?.send(JSON.stringify({
            type: "voice_data",
            audioBase64,
            mimeType: recorder.mimeType,
          }));
        };
        reader.readAsDataURL(blob);
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "[Error] Microphone access denied." },
      ]);
    }
  }, [isRecording]);

  // ── Phase 6: Export ───────────────────────────────────────────────────────────

  const handleExport = useCallback(
    async (format: ExportFormat, includeFrontmatter: boolean) => {
      if (!activeFile || isExporting) return;
      setIsExporting(true);
      try {
        const res = await fetch("/api/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: activeFile, format, includeFrontmatter }),
        });
        const data = (await res.json()) as { url?: string; error?: string };
        if (data.url) {
          // Trigger download
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
            { role: "assistant", text: `[Export error] ${data.error ?? "Unknown error"}` },
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
    [activeFile, isExporting],
  );

  // ── Status indicator ──────────────────────────────────────────────────────────

  const statusLabel =
    agentState === "disconnected"
      ? "○ offline"
      : agentState === "thinking"
      ? "◉ thinking"
      : "● ready";

  const charCount = editorContent.length;
  const showLargeFileWarning = charCount > 50_000 && !dismissedLargeFile;

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
          className={`header-research-btn${showResearch ? " active" : ""}`}
          title="Research panel"
          onClick={() => setShowResearch((v) => !v)}
        >
          ⌕
        </button>
        <button
          className={`header-research-btn${showConflicts ? " active" : ""}`}
          title="Conflicts panel"
          onClick={() => (showConflicts ? setShowConflicts(false) : handleOpenConflicts())}
        >
          ⚡
        </button>
        <button
          className={`header-research-btn${showGraph ? " active" : ""}`}
          title="Knowledge graph"
          onClick={() => (showGraph ? setShowGraph(false) : handleOpenGraph())}
        >
          ◈
        </button>
        <button
          className="header-research-btn"
          title="Export document"
          onClick={() => setShowExport(true)}
        >
          ↓
        </button>
        <button
          className="header-research-btn"
          title="Keyboard shortcuts (?)"
          onClick={() => setShowHelp(true)}
        >
          ?
        </button>
        <button
          className="header-settings-btn"
          title="Style Guide"
          onClick={() => setShowSettings(true)}
        >
          ⚙
        </button>
        <span className={`app-header-status${agentState === "thinking" ? " thinking" : agentState === "disconnected" ? " disconnected" : ""}`}>
          {statusLabel}
        </span>
      </div>

      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showHelp && <HelpPanel onClose={() => setShowHelp(false)} />}
      {showExport && (
        <ExportPanel
          onClose={() => setShowExport(false)}
          onExport={handleExport}
          isExporting={isExporting}
          pandocAvailable={pandocAvailable}
          activeFile={activeFile}
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
      {autolinkSuggestions.length > 0 && (
        <AutolinkBanner
          suggestions={autolinkSuggestions}
          onAccept={handleAutolinkAccept}
          onDismiss={handleAutolinkDismiss}
          onDismissAll={handleAutolinkDismissAll}
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
      {agentState === "disconnected" && (
        <div className="offline-banner">
          AI unavailable — reconnecting…
        </div>
      )}

      {/* Body */}
      <div className="app-body">
        <FileTree
          files={workspaceFiles}
          activeFile={activeFile}
          onFileSelect={openFile}
          onRefresh={refreshFiles}
          onCreateFile={createFile}
          onRenameFile={renameFile}
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
            onImagePaste={handleImagePaste}
            onExplainCode={handleExplainCode}
            isRecording={isRecording}
            onToggleRecording={handleToggleRecording}
            onAskAboutSelection={handleAskAboutSelection}
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

        {showResearch && (
          <ResearchPanel
            onClose={() => setShowResearch(false)}
            onSearch={handleSearch}
            onDetectGaps={handleDetectGaps}
            onIngest={handleIngestFromSearch}
            onReindex={handleReindex}
            onSendToAgent={(text) => { sendToAgent(text); setSidecarCollapsed(false); }}
            searchResults={searchResults}
            gapReport={gapReport}
            isSearching={isSearching}
            isDetectingGaps={isDetectingGaps}
          />
        )}
        {showConflicts && (
          <ConflictsPanel
            onClose={() => setShowConflicts(false)}
            onRefresh={handleContradictionScan}
            contradictions={contradictions}
            isLoading={isScanning}
          />
        )}
        {showGraph && (
          <KnowledgeGraph
            onClose={() => setShowGraph(false)}
            onRefresh={handleRefreshGraph}
            onNodeClick={handleGraphNodeClick}
            graphData={graphData}
            isLoading={isLoadingGraph}
          />
        )}
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
