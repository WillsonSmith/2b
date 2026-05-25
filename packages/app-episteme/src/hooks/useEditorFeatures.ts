import { useCallback, useEffect, useState } from "react";
import type { TocEntry } from "../features/toc.ts";
import type { AgentState, Subscribe } from "./useWebSocket.ts";

export function useEditorFeatures(
  wsRef: React.MutableRefObject<WebSocket | null>,
  agentState: AgentState,
  activeFile: string | null,
  editorContentRef: React.MutableRefObject<string>,
  setEditorContent: React.Dispatch<React.SetStateAction<string>>,
  subscribe: Subscribe,
) {
  const [ghostText, setGhostText] = useState("");
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);

  const [isGeneratingMetadata, setIsGeneratingMetadata] = useState(false);
  const [metadataResult, setMetadataResult] = useState<string | null>(null);

  const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
  const [isTocGenerating, setIsTocGenerating] = useState(false);

  const [diagramResult, setDiagramResult] = useState<{ code: string; placeholderId: string; error?: string } | null>(null);
  const [aiFillResult, setAIFillResult] = useState<{ id: string; content: string; error?: string } | null>(null);

  const handleAutocompleteRequest = useCallback((context: string) => {
    if (!autocompleteEnabled || !wsRef.current || agentState === "disconnected") return;
    if (context.length > 50_000) return;
    wsRef.current.send(JSON.stringify({ type: "autocomplete_request", context }));
  }, [autocompleteEnabled, agentState, wsRef]);

  const handleGhostAccept = useCallback(() => setGhostText(""), []);
  const handleGhostDismiss = useCallback(() => setGhostText(""), []);

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

  const handleAIFillRequest = useCallback(
    async (id: string, instruction: string) => {
      if (!wsRef.current || agentState === "disconnected") {
        console.warn("[ai-fill] cannot send request — disconnected", { agentState });
        return;
      }
      const mentionPattern = /@([\w\-./ ]+\.md)/g;
      const mentionPaths = [...instruction.matchAll(mentionPattern)].map((m) => m[1]!.trim());
      const fetched = await Promise.all(
        mentionPaths.map((path) =>
          fetch(`/api/file-content?path=${encodeURIComponent(path)}`)
            .then((r) => r.json() as Promise<{ content?: string }>)
            .then((d) => (d.content != null ? { path, content: d.content } : null))
            .catch(() => null),
        ),
      );
      const mentions = fetched.filter(
        (m): m is { path: string; content: string } => m !== null,
      );
      console.log("[ai-fill] sending request", { id, instruction, mentions: mentions.map((m) => m.path) });
      wsRef.current.send(JSON.stringify({
        type: "ai_fill_request",
        id,
        instruction,
        document: editorContentRef.current,
        mentions,
      }));
    },
    [agentState, wsRef, editorContentRef],
  );

  const clearMetadata = useCallback(() => setMetadataResult(null), []);
  const clearDiagram = useCallback(() => setDiagramResult(null), []);
  const clearAIFill = useCallback(() => setAIFillResult(null), []);

  // Server → client subscriptions
  useEffect(() => {
    const unsubAuto = subscribe("autocomplete_suggestion", (msg) => setGhostText(msg.text));
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
      setDiagramResult({ code: msg.code, placeholderId: msg.placeholderId, error: msg.error }),
    );
    const unsubAIFill = subscribe("ai_fill_result", (msg) =>
      setAIFillResult({ id: msg.id, content: msg.content, error: msg.error }),
    );
    return () => {
      unsubAuto();
      unsubMetadata();
      unsubFileContentToc();
      unsubToc();
      unsubTocStored();
      unsubDiagram();
      unsubAIFill();
    };
  }, [subscribe, setEditorContent]);

  return {
    ghostText,
    autocompleteEnabled,
    isGeneratingMetadata,
    metadataResult,
    tocEntries,
    isTocGenerating,
    diagramResult,
    aiFillResult,
    setGhostText,
    setAutocompleteEnabled,
    setIsGeneratingMetadata,
    setIsTocGenerating,
    clearMetadata,
    clearDiagram,
    clearAIFill,
    handleAutocompleteRequest,
    handleGhostAccept,
    handleGhostDismiss,
    handleMetadataRequest,
    handleGenerateToc,
    handleDiagramRequest,
    handleAIFillRequest,
  };
}
