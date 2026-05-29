import type { ServerWebSocket } from "bun";
import type { CortexAgent } from "@2b/framework/core/CortexAgent.ts";
import type { EpistemeConfig } from "../config.ts";
import type { WorkspaceDb } from "../db/workspaceDb.ts";
import type { EditorContextPlugin } from "../plugins/EditorContextPlugin.ts";
import type { WorkspacePlugin } from "../plugins/WorkspacePlugin.ts";
import type { ResearchPlugin } from "../plugins/ResearchPlugin.ts";
import type { CitationPlugin } from "../plugins/CitationPlugin.ts";
import type { DiagramPlugin } from "../plugins/DiagramPlugin.ts";
import type { AIFillPlugin } from "../plugins/AIFillPlugin.ts";
import type { StyleGuidePlugin } from "../plugins/style-guide/StyleGuidePlugin.ts";
import type { ContradictionPlugin } from "../plugins/ContradictionPlugin.ts";
import type { PlanningController } from "../planning/PlanningController.ts";
import type { AutocompleteRunner } from "../features/autocomplete.ts";
import type { ServerMsg } from "../protocol.ts";
import type { WebSocketPermissionManager } from "./WebSocketPermissionManager.ts";

/**
 * Bundle passed to every WebSocket message handler. Holds the agent + plugin
 * instances, shared runners, and the helpers a handler needs to talk back to
 * the client (per-socket `send`, all-client `broadcast`).
 */
export interface WsContext {
  agent: CortexAgent;
  editorContext: EditorContextPlugin;
  workspace: WorkspacePlugin;
  research: ResearchPlugin;
  citation: CitationPlugin;
  diagram: DiagramPlugin;
  aiFill: AIFillPlugin;
  styleGuide: StyleGuidePlugin;
  contradiction: ContradictionPlugin;
  planning: PlanningController;
  workspaceDb: WorkspaceDb;
  config: EpistemeConfig;
  absRoot: string;
  autocomplete: AutocompleteRunner;
  broadcast: (msg: ServerMsg) => void;
  send: (ws: ServerWebSocket<unknown>, msg: ServerMsg) => void;
  collectMarkdownFiles: () => Promise<string[]>;
  collectSubdirectories: () => Promise<string[]>;
  resolveWorkspacePath: (path: string) => string | null;
  scheduleWorkspaceRefresh: () => void;
  suppressExternalChange: (absolutePath: string) => void;
  /** Activate a mode-gated plugin by name. No-op if already active or unknown. */
  activatePlugin: (name: string) => void;
  /** Resolves outstanding tool-approval requests with client-side decisions. */
  permissionManager: WebSocketPermissionManager;
}
