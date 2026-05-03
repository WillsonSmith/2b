import { useCallback, useEffect, useRef, useState } from "react";
import type { UnifiedSearchResponse } from "../plugins/ResearchPlugin.ts";
import type { ContradictionRecord, GraphData } from "../features/contradiction.ts";
import type { CitationCheckResult } from "../plugins/CitationPlugin.ts";
import type { LintIssue } from "../features/lint.ts";
import type { TocEntry } from "../features/toc.ts";
import type { WikilinkSuggestion } from "../features/autolink.ts";
import { assertNever, type ServerMsg } from "../protocol.ts";

type AgentState = "idle" | "thinking" | "disconnected";

export interface UseWebSocketCallbacks {
  onSpeak: (text: string) => void;
  onStateChange: (state: "idle" | "thinking") => void;
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  onToolResult: (name: string) => void;
  onFileContent: (path: string, content: string) => void;
  onWorkspaceFiles: (files: string[]) => void;
  onFileSaved: () => void;
  onFileCreated: (path: string) => void;
  onFileRenamed: (oldPath: string, newPath: string) => void;
  onAutocompleteSuggestion: (text: string) => void;
  onInsertText: (text: string) => void;
  onIngestResult: (success: boolean, message: string) => void;
  onLintResult: (issues: LintIssue[]) => void;
  onToneResult: (text: string, from: number, to: number) => void;
  onSummarizeResult: (text: string, insertPos: number) => void;
  onMetadataResult: (yaml: string) => void;
  onTocResult: (entries: TocEntry[]) => void;
  onAutolinkResult: (suggestions: WikilinkSuggestion[]) => void;
  onDiagramResult: (code: string, from: number, to: number) => void;
  onTableResult: (text: string, insertPos: number) => void;
  onSearchResult: (results: UnifiedSearchResponse) => void;
  onDetectGapsResult: (markdown: string) => void;
  onContradictionsData: (contradictions: ContradictionRecord[]) => void;
  onGraphData: (data: GraphData) => void;
  onCheckCitationsResult: (result: CitationCheckResult) => void;
  onFormatCitationResult: (bibtex: string) => void;
  onAltText: (text: string, mimeType: string, base64: string) => void;
  onExplainCodeResult: (explanation: string) => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}

export function useWebSocket(callbacks: UseWebSocketCallbacks): {
  wsRef: React.MutableRefObject<WebSocket | null>;
  agentState: AgentState;
  sendToAgent: (text: string) => void;
  interrupt: () => void;
} {
  const [agentState, setAgentState] = useState<AgentState>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(`ws://${location.host}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setAgentState("idle");
        ws.send(JSON.stringify({ type: "list_workspace" }));
      };

      ws.onclose = () => {
        setAgentState("disconnected");
        wsRef.current = null;
        setTimeout(connect, 2000);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMsg;
        const cb = callbacksRef.current;
        switch (msg.type) {
          case "state_change":
            setAgentState(msg.state);
            cb.onStateChange(msg.state);
            break;
          case "speak":
            cb.onSpeak(msg.text);
            break;
          case "tool_call":
            cb.onToolCall(msg.name, msg.args);
            break;
          case "tool_result":
            cb.onToolResult(msg.name);
            break;
          case "workspace_files":
            cb.onWorkspaceFiles(msg.files);
            break;
          case "file_content":
            cb.onFileContent(msg.path, msg.content);
            break;
          case "file_created":
            cb.onFileCreated(msg.path);
            break;
          case "file_renamed":
            cb.onFileRenamed(msg.oldPath, msg.newPath);
            break;
          case "file_saved":
            cb.onFileSaved();
            break;
          case "autocomplete_suggestion":
            cb.onAutocompleteSuggestion(msg.text);
            break;
          case "insert_text":
            cb.onInsertText(msg.text);
            break;
          case "ingest_result":
            cb.onIngestResult(msg.success, msg.message);
            break;
          case "lint_result":
            cb.onLintResult(msg.issues);
            break;
          case "tone_result":
            cb.onToneResult(msg.text, msg.from, msg.to);
            break;
          case "summarize_result":
            cb.onSummarizeResult(msg.text, msg.insertPos);
            break;
          case "metadata_result":
            cb.onMetadataResult(msg.yaml);
            break;
          case "toc_result":
            cb.onTocResult(msg.entries);
            break;
          case "autolink_result":
            cb.onAutolinkResult(msg.suggestions);
            break;
          case "diagram_result":
            cb.onDiagramResult(msg.code, msg.from, msg.to);
            break;
          case "table_result":
            cb.onTableResult(msg.text, msg.insertPos);
            break;
          case "search_result":
            cb.onSearchResult(msg.results);
            break;
          case "detect_gaps_result":
            cb.onDetectGapsResult(msg.markdown);
            break;
          case "contradictions_data":
            cb.onContradictionsData(msg.contradictions);
            break;
          case "graph_data":
            cb.onGraphData(msg.data);
            break;
          case "check_citations_result":
            cb.onCheckCitationsResult(msg.result);
            break;
          case "format_citation_result":
            cb.onFormatCitationResult(msg.bibtex);
            break;
          case "alt_text":
            cb.onAltText(msg.text, msg.mimeType, msg.base64);
            break;
          case "explain_code_result":
            cb.onExplainCodeResult(msg.explanation);
            break;
          case "transcript":
            cb.onTranscript(msg.text);
            break;
          case "error":
            cb.onError(msg.message);
            break;
          default:
            assertNever(msg);
        }
      };
    }

    connect();
    return () => wsRef.current?.close();
  }, []);

  const sendToAgent = useCallback((text: string) => {
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "send", text }));
  }, [agentState]);

  const interrupt = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }, []);

  return { wsRef, agentState, sendToAgent, interrupt };
}
