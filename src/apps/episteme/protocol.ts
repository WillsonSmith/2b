/**
 * Episteme WebSocket protocol — single source of truth shared by server and client.
 *
 * Both `server.ts` and `hooks/useWebSocket.ts` `import type` from here. When a new
 * message type is added, the `assertNever` exhaustiveness checks in both switch
 * statements will fail to compile until both sides handle it.
 */

import type { Tone } from "./features/tone.ts";
import type { LintIssue } from "./features/lint.ts";
import type { TocEntry } from "./features/toc.ts";
import type { WikilinkSuggestion } from "./features/autolink.ts";
import type { UnifiedSearchResponse } from "./plugins/ResearchPlugin.ts";
import type { CitationCheckResult } from "./plugins/CitationPlugin.ts";
import type { ContradictionRecord, GraphData } from "./plugins/ContradictionPlugin.ts";

export type AgentRunState = "idle" | "thinking";

export type ClientMsg =
  | { type: "send"; text: string }
  | { type: "interrupt" }
  | { type: "editor_context"; file: string; content: string; cursor: number }
  | { type: "file_open"; path: string }
  | { type: "file_save"; path: string; content: string }
  | { type: "file_create"; path: string }
  | { type: "file_rename"; oldPath: string; newPath: string }
  | { type: "list_workspace" }
  | { type: "autocomplete_request"; context: string }
  | { type: "outline_request"; topic: string }
  | { type: "ingest_url"; url: string }
  | { type: "ingest_pdf"; path: string }
  | { type: "tone_transform"; text: string; tone: Tone; from: number; to: number }
  | { type: "summarize_request"; text: string; insertPos: number }
  | { type: "metadata_request"; title: string; preview: string }
  | { type: "toc_request"; markdown: string }
  | { type: "autolink_request"; markdown: string; files: string[] }
  | { type: "diagram_request"; description: string; from: number; to: number }
  | { type: "table_request"; text: string; insertPos: number }
  | { type: "search_request"; query: string }
  | { type: "detect_gaps_request"; topic: string }
  | { type: "contradictions_request" }
  | { type: "contradiction_scan_request" }
  | { type: "graph_request" }
  | { type: "check_citations_request" }
  | { type: "format_citation_request"; url: string }
  | { type: "analyze_image"; base64: string; mimeType: string; filename: string }
  | { type: "explain_code"; code: string; language: string }
  | { type: "voice_data"; audioBase64: string; mimeType: string };

export type ServerMsg =
  | { type: "speak"; text: string }
  | { type: "state_change"; state: AgentRunState }
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
  | { type: "check_citations_result"; result: CitationCheckResult }
  | { type: "format_citation_result"; bibtex: string }
  | { type: "alt_text"; text: string; mimeType: string; base64: string }
  | { type: "explain_code_result"; explanation: string }
  | { type: "transcript"; text: string }
  | { type: "error"; message: string };

export function assertNever(x: never): never {
  throw new Error(`Unhandled protocol message: ${JSON.stringify(x)}`);
}
