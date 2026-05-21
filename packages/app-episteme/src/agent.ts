import { CortexAgent } from "@2b/framework/core/CortexAgent.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import { FileSystemPlugin } from "@2b/framework/plugins/FileSystemPlugin.ts";
import { DynamicAgentPlugin } from "@2b/framework/plugins/DynamicAgentPlugin.ts";
import { BehaviorPlugin } from "@2b/framework/plugins/BehaviorPlugin.ts";
import { MemoryPlugin } from "@2b/framework/plugins/MemoryPlugin.ts";
import { AutoApprovePermissionManager } from "@2b/framework/core/PermissionManager.ts";
import type { AgentPlugin } from "@2b/framework/core/Plugin.ts";
import type { BaseAgent } from "@2b/framework/core/BaseAgent.ts";
import { EditorContextPlugin } from "./plugins/EditorContextPlugin.ts";
import { WorkspacePlugin } from "./plugins/WorkspacePlugin.ts";
import { ResearchPlugin } from "./plugins/ResearchPlugin.ts";
import { StyleGuidePlugin } from "./plugins/StyleGuidePlugin.ts";
import { DiagramPlugin } from "./plugins/DiagramPlugin.ts";
import { AIFillPlugin } from "./plugins/AIFillPlugin.ts";
import { CitationPlugin } from "./plugins/CitationPlugin.ts";
import { ContradictionPlugin } from "./plugins/ContradictionPlugin.ts";
import { PlanningPlugin } from "./plugins/PlanningPlugin.ts";
import { workspaceDbPath } from "./paths.ts";
import { WorkspaceDb } from "./db/workspaceDb.ts";
import type { EpistemeConfig } from "./config.ts";

export type AgentMode = "standard" | "extended";

/**
 * Wraps a plugin and suppresses its tool surface, system-prompt fragment, and
 * per-turn context when the shared mode state is "standard". All other hooks
 * (onInit, executeTool, onMessage, …) always delegate so that server-side
 * direct calls and background tasks keep working regardless of mode.
 */
class ModeGated implements AgentPlugin {
  readonly name: string;

  constructor(private readonly inner: AgentPlugin, private readonly state: { mode: AgentMode }) {
    this.name = inner.name;
  }

  private get active() { return this.state.mode === "extended"; }

  onInit(agent: BaseAgent) { return this.inner.onInit?.(agent); }
  getSystemPromptFragment(ctx?: string) { return this.active ? (this.inner.getSystemPromptFragment?.(ctx) ?? "") : ""; }
  getContext(events?: string[]) { return this.active ? (this.inner.getContext?.(events) ?? "") : ""; }
  getTools() { return this.active ? (this.inner.getTools?.() ?? []) : []; }
  async executeTool(name: string, args: Record<string, unknown>) { return this.inner.executeTool?.(name, args); }
  onMessage(role: "user" | "assistant" | "system", content: string, source: string) { return this.inner.onMessage?.(role, content, source); }
  getMessages(limit?: number) { return this.inner.getMessages?.(limit) ?? []; }
  onError(error: Error) { return this.inner.onError?.(error); }
  augmentResponse(response: string) { return this.inner.augmentResponse?.(response) ?? response; }
}

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
  aiFill: AIFillPlugin;
  contradiction: ContradictionPlugin;
  planning: PlanningPlugin;
  workspaceDb: WorkspaceDb;
  shortTermMemory: MemoryPlugin;
  /** Current agent mode. Mutate via setMode(). */
  modeState: { mode: AgentMode };
  setMode: (mode: AgentMode) => void;
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

  // Shared mode state — mutated by setMode(), read by every ModeGated wrapper
  // on each tick so mode changes take effect without restarting the agent.
  const modeState: { mode: AgentMode } = { mode: "standard" };

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
  const aiFill = new AIFillPlugin(config);
  const contradiction = new ContradictionPlugin(
    agent.memoryPlugin,
    config,
    workspaceDb,
  );
  const planning = new PlanningPlugin(workspaceDb);
  const dynamicAgent = new DynamicAgentPlugin(llm, {
    permissionManager,
    parentMemory: agent.memoryPlugin,
  });

  const shortTermMemory = new MemoryPlugin(llm, { minMessages: 10, maxMessages: 15 });

  // Always-on plugins — registered directly, never mode-gated.
  agent.registerPlugin(shortTermMemory);
  agent.registerPlugin(new BehaviorPlugin(agent.memoryPlugin, llm));
  agent.registerPlugin(new FileSystemPlugin({ allowedRoots: [workspaceRoot], maxReadBytes: 25 * 1024 }));
  agent.registerPlugin(editorContext);
  agent.registerPlugin(workspace);
  agent.registerPlugin(research);
  agent.registerPlugin(planning);

  // Mode-gated plugins — always registered (so onInit fires during agent.start())
  // but their tool surface and system-prompt fragments are suppressed in standard mode.
  agent.registerPlugin(new ModeGated(styleGuide, modeState));
  agent.registerPlugin(new ModeGated(citation, modeState));
  agent.registerPlugin(new ModeGated(diagram, modeState));
  agent.registerPlugin(aiFill); // zero tools, no fragment — no need to gate
  agent.registerPlugin(new ModeGated(contradiction, modeState));
  agent.registerPlugin(new ModeGated(dynamicAgent, modeState));

  function setMode(mode: AgentMode) {
    modeState.mode = mode;
    agent.invalidateToolCache();
  }

  return {
    agent,
    editorContext,
    workspace,
    styleGuide,
    research,
    citation,
    diagram,
    aiFill,
    contradiction,
    planning,
    workspaceDb,
    shortTermMemory,
    modeState,
    setMode,
  };
}
