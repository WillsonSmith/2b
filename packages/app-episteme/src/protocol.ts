/**
 * Episteme WebSocket protocol — single source of truth shared by server and client.
 *
 * Both `server.ts` and `hooks/useWebSocket.ts` `import type` from here. When a new
 * message type is added, the `assertNever` exhaustiveness checks in both switch
 * statements will fail to compile until both sides handle it.
 */

import type { BacklinkItem } from "./features/links.ts";
import type { TocEntry } from "./features/toc.ts";
import type { UnifiedSearchResponse } from "./plugins/ResearchPlugin.ts";
import type { CitationCheckResult } from "./plugins/CitationPlugin.ts";
import type { ContradictionRecord } from "./plugins/ContradictionPlugin.ts";
import type { GraphData } from "./plugins/WorkspacePlugin.ts";
import type { EpistemePlan, PlanStepDraft } from "./planning/types.ts";

export type AgentRunState =
  | "idle"
  | "thinking"
  | "structuring"
  | "awaiting_approval"
  | "awaiting_step"
  | "executing"
  | "step_failed"
  | "paused";

export type ClientMsg =
  | { type: "send"; text: string }
  | { type: "interrupt" }
  | { type: "editor_context"; file: string; content: string; cursor: number }
  | { type: "file_open"; path: string }
  | { type: "file_save"; path: string; content: string }
  | { type: "file_create"; path: string }
  | { type: "folder_create"; path: string }
  | { type: "folder_rename"; oldPath: string; newPath: string }
  | { type: "file_rename"; oldPath: string; newPath: string }
  | { type: "file_delete"; path: string }
  | { type: "list_workspace" }
  | { type: "get_filetree_expanded" }
  | { type: "set_filetree_expanded"; paths: string[] }
  | { type: "autocomplete_request"; context: string }
  | { type: "ingest_url"; url: string }
  | { type: "ingest_pdf"; path: string }
  | { type: "metadata_request"; title: string; preview: string }
  | { type: "toc_request"; markdown: string; file?: string }
  | { type: "diagram_request"; description: string; placeholderId: string }
  | { type: "ai_fill_request"; id: string; instruction: string; document: string; mentions: Array<{ path: string; content: string }> }
  | { type: "search_request"; query: string }
  | { type: "detect_gaps_request"; topic: string }
  | { type: "contradictions_request" }
  | { type: "contradiction_scan_request" }
  | { type: "graph_request"; limit?: number; offset?: number }
  | { type: "reindex_request" }
  | { type: "check_citations_request" }
  | { type: "format_citation_request"; url: string }
  | { type: "analyze_image"; base64: string; mimeType: string; filename: string }
  | { type: "explain_code"; code: string; language: string }
  | { type: "voice_data"; audioBase64: string; mimeType: string }
  | { type: "open_in_finder"; path: string }
  | { type: "backlinks_request"; path: string }
  | { type: "plan_request"; goal: string; approvalMode: "all" | "per_step"; previousPlanId?: string }
  | { type: "plan_from_document"; path: string; goal: string; approvalMode: "all" | "per_step"; previousPlanId?: string }
  | { type: "plan_approve"; planId: string }
  | { type: "plan_approve_step"; planId: string; stepId: string }
  | { type: "plan_retry_step"; planId: string; stepId: string }
  | { type: "plan_skip_step"; planId: string; stepId: string }
  | { type: "plan_amend_steps"; planId: string; steps: PlanStepDraft[] }
  | { type: "plan_edit_step_summary"; planId: string; stepId: string; summary: string }
  | { type: "plan_edit_step_instruction"; planId: string; stepId: string; instruction: string }
  | { type: "plan_add_step"; planId: string; description: string; insertAfterStepId?: string | null }
  | { type: "plan_reorder_step"; planId: string; stepId: string; direction: "up" | "down" }
  | { type: "plan_pause" }
  | { type: "plan_resume" }
  | { type: "plan_resume_auto" }
  | { type: "plan_cancel" }
  | { type: "permission_response"; id: string; decision: "allow_once" | "allow_session" | "deny" };

export type ServerMsg =
  | { type: "speak"; text: string }
  | { type: "state_change"; state: AgentRunState }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; error?: string }
  | { type: "file_content"; path: string; content: string }
  | { type: "workspace_files"; files: string[]; folders: string[] }
  | { type: "index_progress"; indexed: number; total: number }
  | { type: "file_saved" }
  | { type: "file_created"; path: string }
  | { type: "file_renamed"; oldPath: string; newPath: string }
  | { type: "file_deleted"; path: string }
  | { type: "filetree_expanded"; paths: string[] }
  | { type: "autocomplete_suggestion"; text: string }
  | { type: "ingest_result"; success: boolean; message: string }
  | { type: "metadata_result"; yaml: string }
  | { type: "toc_result"; entries: TocEntry[] }
  | { type: "toc_stored"; file: string; entries: TocEntry[] }
  | { type: "diagram_result"; code: string; placeholderId: string; error?: string }
  | { type: "ai_fill_result"; id: string; content: string; error?: string }
  | { type: "search_result"; results: UnifiedSearchResponse }
  | { type: "detect_gaps_result"; markdown: string }
  | { type: "contradictions_data"; contradictions: ContradictionRecord[] }
  | { type: "contradiction_notification"; count: number }
  | { type: "graph_data"; data: GraphData; pagination: { offset: number; limit: number; totalFiles: number } }
  | { type: "check_citations_result"; result: CitationCheckResult }
  | { type: "format_citation_result"; bibtex: string }
  | { type: "alt_text"; text: string }
  | { type: "explain_code_result"; explanation: string }
  | { type: "transcript"; text: string }
  | { type: "file_externally_changed"; path: string; content: string }
  | { type: "backlinks_result"; path: string; items: BacklinkItem[] }
  | { type: "error"; message: string }
  | { type: "provider_status"; reachable: boolean; endpoint: string; reason?: string }
  | { type: "plan_created"; plan: EpistemePlan }
  | { type: "plan_updated"; plan: EpistemePlan }
  | { type: "plan_step_started"; planId: string; stepId: string }
  | { type: "plan_step_completed"; planId: string; stepId: string; summary: string }
  | { type: "plan_step_failed"; planId: string; stepId: string; error: string }
  | { type: "plan_complete"; planId: string }
  | { type: "agent_mode_changed"; activePlugins: string[]; availablePlugins: string[] }
  | {
      type: "empty_response";
      attempt: number;
      hadThinking: boolean;
      /** True when the retry also returned empty — UI should surface this to the user. */
      failed?: boolean;
    }
  | {
      type: "permission_request";
      id: string;
      agentName: string;
      toolName: string;
      args: Record<string, unknown>;
      /** Optional file diff payload for file-write tools. */
      fileDiff?: { path: string; currentContent: string; proposedContent: string };
    };

export function assertNever(x: never): never {
  throw new Error(`Unhandled protocol message: ${JSON.stringify(x)}`);
}
