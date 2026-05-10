import { useCallback, useEffect, useState } from "react";
import type { Tone } from "../features/tone.ts";
import type { LintIssue } from "../features/lint.ts";
import type { TocEntry } from "../features/toc.ts";
import type { Subscribe } from "./useWebSocket.ts";
import { useDebounce } from "./useDebounce.ts";

type AgentState = "idle" | "thinking" | "disconnected";

export function useEditorFeatures(
  wsRef: React.MutableRefObject<WebSocket | null>,
  agentState: AgentState,
  activeFile: string | null,
  editorContent: string,
  editorContentRef: React.MutableRefObject<string>,
  setEditorContent: React.Dispatch<React.SetStateAction<string>>,
  subscribe: Subscribe,
) {
  const [ghostText, setGhostText] = useState("");
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);
  const [lintEnabled, setLintEnabled] = useState(true);

  const [toneReplacement, setToneReplacement] = useState<{ text: string; from: number; to: number } | null>(null);
  const [summarizeResult, setSummarizeResult] = useState<{ text: string; insertPos: number } | null>(null);

  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);
  const [metadataResult, setMetadataResult] = useState<string | null>(null);

  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [isTocGenerating, setIsTocGenerating] = useState(false);

  const [diagramResult, setDiagramResult] = useState<{ code: string; placeholderId: string } | null>(null);
  const [tableResult, setTableResult] = useState<{ text: string; insertPos: number } | null>(null);

  const [lintIssues, setLintIssues] = useState<LintIssue[]>([]);

  const handleAutocompleteRequest = useCallback((context: string) => {
    if (!autocompleteEnabled || !wsRef.current || agentState === "disconnected") return;
    if (context.length > 50_000) return;
    wsRef.current.send(JSON.stringify({ type: "autocomplete_request", context }));
  }, [autocompleteEnabled, agentState, wsRef]);

  const handleGhostAccept = useCallback(() => setGhostText(""), []);
  const handleGhostDismiss = useCallback(() => setGhostText(""), []);

  const handleToneRequest = useCallback(
    (text: string, tone: Tone, from: number, to: number) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "tone_transform", text, tone, from, to }));
    },
    [agentState, wsRef],
  );

  const handleSummarizeRequest = useCallback(
    (text: string, insertPos: number) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "summarize_request", text, insertPos }));
    },
    [agentState, wsRef],
  );

  const handleMetadataRequest = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected" || isGeneratingMetadata) return;
    const title = activeFile
      ? activeFile.replace(/\.md$/i, "").split("/").at(-1) ?? ""
      : "";
    const preview = editorContentRef.current;
    setIsGeneratingMetadata(true);
    wsRef.current.send(JSON.stringify({ type: "metadata_request", title, preview }));
  }, [agentState, activeFile, isGeneratingMetadata, wsRef, editorContentRef]);

  const handleGenerateToc = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected" || isTocGenerating) return;
    const markdown = editorContentRef.current;
    if (!markdown.trim()) return;
    setIsTocGenerating(true);
    wsRef.current.send(JSON.stringify({ type: "toc_request", markdown, file: activeFile ?? "" }));
  }, [agentState, isTocGenerating, wsRef, editorContentRef, activeFile]);

  const handleDiagramRequest = useCallback(
    (description: string, placeholderId: string) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "diagram_request", description, placeholderId }));
    },
    [agentState, wsRef],
  );

  const handleTableRequest = useCallback(
    (text: string, insertPos: number) => {
      if (!wsRef.current || agentState === "disconnected") return;
      wsRef.current.send(JSON.stringify({ type: "table_request", text, insertPos }));
    },
    [agentState, wsRef],
  );

  // Idle-debounced lint — fires 5s after the user stops typing, decoupled
  // from autosave so the linter doesn't spin every 2s.
  const debouncedLintContent = useDebounce(editorContent, 5000);
  useEffect(() => {
    if (!lintEnabled || !activeFile || !wsRef.current || agentState === "disconnected") return;
    const trimmed = debouncedLintContent.trim();
    if (!trimmed) return;
    wsRef.current.send(JSON.stringify({ type: "lint_request", content: debouncedLintContent }));
  }, [lintEnabled, debouncedLintContent, activeFile, agentState, wsRef]);

  // Server → client subscriptions
  useEffect(() => {
    const unsubAuto = subscribe("autocomplete_suggestion", (msg) => setGhostText(msg.text));
    const unsubLint = subscribe("lint_result", (msg) => setLintIssues(msg.issues));
    const unsubTone = subscribe("tone_result", (msg) =>
      setToneReplacement({ text: msg.text, from: msg.from, to: msg.to }),
    );
    const unsubSummarize = subscribe("summarize_result", (msg) =>
      setSummarizeResult({ text: msg.text, insertPos: msg.insertPos }),
    );
    const unsubMetadata = subscribe("metadata_result", (msg) => {
      setMetadataResult(msg.yaml);
      setIsGeneratingMetadata(false);
    });
    const unsubFileContentToc = subscribe("file_content", () => {
      setTocEntries([]);
      setIsTocGenerating(false);
    });
    const unsubToc = subscribe("toc_result", (msg) => {
      setTocEntries(msg.entries);
      setIsTocGenerating(false);
    });
    const unsubTocStored = subscribe("toc_stored", (msg) => {
      setTocEntries(msg.entries);
    });
    const unsubDiagram = subscribe("diagram_result", (msg) =>
      setDiagramResult({ code: msg.code, placeholderId: msg.placeholderId }),
    );
    const unsubTable = subscribe("table_result", (msg) =>
      setTableResult({ text: msg.text, insertPos: msg.insertPos }),
    );
    return () => {
      unsubAuto();
      unsubLint();
      unsubTone();
      unsubSummarize();
      unsubMetadata();
      unsubFileContentToc();
      unsubToc();
      unsubTocStored();
      unsubDiagram();
      unsubTable();
    };
  }, [subscribe, setEditorContent]);

  return {
    ghostText,
    autocompleteEnabled,
    lintEnabled,
    toneReplacement,
    summarizeResult,
    isGeneratingMetadata,
    metadataResult,
    tocEntries,
    isTocGenerating,
    diagramResult,
    tableResult,
    lintIssues,
    setGhostText,
    setAutocompleteEnabled,
    setLintEnabled,
    setToneReplacement,
    setSummarizeResult,
    setIsGeneratingMetadata,
    setMetadataResult,
    setTocEntries,
    setIsTocGenerating,
    setDiagramResult,
    setTableResult,
    setLintIssues,
    handleAutocompleteRequest,
    handleGhostAccept,
    handleGhostDismiss,
    handleToneRequest,
    handleSummarizeRequest,
    handleMetadataRequest,
    handleGenerateToc,
    handleDiagramRequest,
    handleTableRequest,
  };
}
