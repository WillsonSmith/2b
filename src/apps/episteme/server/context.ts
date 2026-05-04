import type { ServerWebSocket } from "bun";
import type { CortexAgent } from "../../../core/CortexAgent.ts";
import type { EpistemeConfig } from "../config.ts";
import type { WorkspaceDb } from "../db/workspaceDb.ts";
import type { EditorContextPlugin } from "../plugins/EditorContextPlugin.ts";
import type { WorkspacePlugin } from "../plugins/WorkspacePlugin.ts";
import type { ResearchPlugin } from "../plugins/ResearchPlugin.ts";
import type { CitationPlugin } from "../plugins/CitationPlugin.ts";
import type { DiagramPlugin } from "../plugins/DiagramPlugin.ts";
import type { StyleGuidePlugin } from "../plugins/StyleGuidePlugin.ts";
import type { AutocompleteRunner } from "../features/autocomplete.ts";
import type { LintRunner } from "../features/lint.ts";
import type { ServerMsg } from "../protocol.ts";

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
  styleGuide: StyleGuidePlugin;
  workspaceDb: WorkspaceDb;
  config: EpistemeConfig;
  absRoot: string;
  autocomplete: AutocompleteRunner;
  linter: LintRunner;
  broadcast: (msg: ServerMsg) => void;
  send: (ws: ServerWebSocket<unknown>, msg: ServerMsg) => void;
  collectMarkdownFiles: () => Promise<string[]>;
  resolveWorkspacePath: (path: string) => string | null;
  scheduleWorkspaceRefresh: () => void;
}
