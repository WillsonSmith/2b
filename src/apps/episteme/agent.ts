import { CortexAgent } from "../../core/CortexAgent.ts";
import { createProvider } from "../../providers/llm/createProvider.ts";
import { FileSystemPlugin } from "../../plugins/FileSystemPlugin.ts";
import { DynamicAgentPlugin } from "../../plugins/DynamicAgentPlugin.ts";
import { BehaviorPlugin } from "../../plugins/BehaviorPlugin.ts";
import { MemoryPlugin } from "../../plugins/MemoryPlugin.ts";
import { AutoApprovePermissionManager } from "../../core/PermissionManager.ts";
import { EditorContextPlugin } from "./plugins/EditorContextPlugin.ts";
import { WorkspacePlugin } from "./plugins/WorkspacePlugin.ts";
import { ResearchPlugin } from "./plugins/ResearchPlugin.ts";
import { StyleGuidePlugin } from "./plugins/StyleGuidePlugin.ts";
import { DiagramPlugin } from "./plugins/DiagramPlugin.ts";
import { CitationPlugin } from "./plugins/CitationPlugin.ts";
import { ContradictionPlugin } from "./plugins/ContradictionPlugin.ts";
import { workspaceDbPath } from "./paths.ts";
import { WorkspaceDb } from "./db/workspaceDb.ts";
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

export interface EpistemeAgentBundle {
  agent: CortexAgent;
  editorContext: EditorContextPlugin;
  workspace: WorkspacePlugin;
  styleGuide: StyleGuidePlugin;
  research: ResearchPlugin;
  citation: CitationPlugin;
  diagram: DiagramPlugin;
  contradiction: ContradictionPlugin;
  workspaceDb: WorkspaceDb;
}

export function createEpistemAgent(
  workspaceRoot: string,
  config: EpistemeConfig,
): EpistemeAgentBundle {
  const llm = createProvider(config.models.default);
  const dbPath = workspaceDbPath(workspaceRoot);
  const workspaceDb = new WorkspaceDb(dbPath);

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
  const workspace = new WorkspacePlugin(workspaceRoot, workspaceDb);
  const research = new ResearchPlugin(
    workspaceRoot,
    config,
    agent.memoryPlugin,
    workspaceDb,
    workspace,
  );
  const styleGuide = new StyleGuidePlugin(workspaceRoot);
  const citation = new CitationPlugin(workspaceRoot, config, editorContext);
  const diagram = new DiagramPlugin(config);
  const contradiction = new ContradictionPlugin(
    agent.memoryPlugin,
    config,
    workspaceDb,
  );

  agent.registerPlugin(
    new MemoryPlugin(llm, { minMessages: 15, maxMessages: 30 }),
  );
  agent.registerPlugin(new BehaviorPlugin(agent.memoryPlugin, llm));
  agent.registerPlugin(new FileSystemPlugin({ allowedRoots: [workspaceRoot] }));
  agent.registerPlugin(editorContext);
  agent.registerPlugin(workspace);
  agent.registerPlugin(research);
  agent.registerPlugin(styleGuide);
  agent.registerPlugin(citation);
  agent.registerPlugin(diagram);
  agent.registerPlugin(contradiction);
  agent.registerPlugin(
    new DynamicAgentPlugin(llm, {
      permissionManager,
      parentMemory: agent.memoryPlugin,
    }),
  );

  return {
    agent,
    editorContext,
    workspace,
    styleGuide,
    research,
    citation,
    diagram,
    contradiction,
    workspaceDb,
  };
}
