import { CortexAgent } from "../../core/CortexAgent.ts";
import { createProvider } from "../../providers/llm/createProvider.ts";
import { FileSystemPlugin } from "../../plugins/FileSystemPlugin.ts";
import { DynamicAgentPlugin } from "../../plugins/DynamicAgentPlugin.ts";
import { BehaviorPlugin } from "../../plugins/BehaviorPlugin.ts";
import { MemoryPlugin } from "../../plugins/MemoryPlugin.ts";
import { AutoApprovePermissionManager } from "../../core/PermissionManager.ts";
import { EditorContextPlugin } from "./plugins/EditorContextPlugin.ts";
import { WorkspacePlugin } from "./plugins/WorkspacePlugin.ts";
import { workspaceDbPath } from "./paths.ts";
import type { EpistemeConfig } from "./config.ts";

const SYSTEM_PROMPT = `You are Episteme, an AI research assistant embedded in a Markdown editor.

Your role is to help users:
- Draft and refine Markdown documents
- Research topics and synthesize information
- Organize their knowledge workspace
- Identify connections and contradictions across their notes

Your primary context is the current workspace and its documents.
Be concise and precise. Prefer structured Markdown output when providing content.
When editing or generating text, preserve the user's voice and style.`;

export interface EpistemAgentBundle {
  agent: CortexAgent;
  editorContext: EditorContextPlugin;
  workspace: WorkspacePlugin;
}

export function createEpistemAgent(
  workspaceRoot: string,
  config: EpistemeConfig,
): EpistemAgentBundle {
  const llm = createProvider(config.models.default);
  const dbPath = workspaceDbPath(workspaceRoot);

  // AutoApprove is used for Phase 0 development.
  // Phase 1 will replace this with a WebPermissionManager tied to the browser client.
  const permissionManager = new AutoApprovePermissionManager();

  const agent = new CortexAgent(llm, {
    name: "Episteme",
    cortexName: "episteme",
    model: config.models.default,
    memoryDbPath: dbPath,
    systemPrompt: SYSTEM_PROMPT,
    heartbeatInterval: 5000,
    permissionManager,
  });

  const editorContext = new EditorContextPlugin();
  // Pass memoryPlugin so WorkspacePlugin can write indexed file content into FTS5 search
  const workspace = new WorkspacePlugin(workspaceRoot, agent.memoryPlugin);

  agent.registerPlugin(new MemoryPlugin());
  agent.registerPlugin(new BehaviorPlugin(agent.memoryPlugin, llm));
  agent.registerPlugin(new FileSystemPlugin());
  agent.registerPlugin(editorContext);
  agent.registerPlugin(workspace);
  agent.registerPlugin(
    new DynamicAgentPlugin(llm, {
      permissionManager,
      parentMemory: agent.memoryPlugin,
    }),
  );

  return { agent, editorContext, workspace };
}
