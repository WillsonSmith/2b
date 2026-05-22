import { CortexAgent } from "@2b/framework/core/CortexAgent.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import { FileSystemPlugin } from "@2b/framework/plugins/FileSystemPlugin.ts";
import { BehaviorPlugin } from "@2b/framework/plugins/BehaviorPlugin.ts";
import { MemoryPlugin } from "@2b/framework/plugins/MemoryPlugin.ts";
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
import { WebSocketPermissionManager } from "./server/WebSocketPermissionManager.ts";

/**
 * Wraps a plugin and suppresses its tool surface, system-prompt fragment, and
 * per-turn context unless its name is in the shared `activePlugins` set. All
 * other hooks (onInit, executeTool, onMessage, …) always delegate so that
 * server-side direct calls and background tasks keep working regardless.
 */
class ModeGated implements AgentPlugin {
  readonly name: string;

  constructor(private readonly inner: AgentPlugin, private readonly activePlugins: Set<string>) {
    this.name = inner.name;
  }

  private get active() { return this.activePlugins.has(this.inner.name); }

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

/** Names of mode-gated plugins, in registration order. */
export const MODE_GATED_PLUGIN_NAMES = [
  "Citation",
  "StyleGuide",
  "Diagram",
  "Contradiction",
] as const;

export type ModeGatedPluginName = (typeof MODE_GATED_PLUGIN_NAMES)[number];

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
  /** Permission manager that surfaces approval prompts to the Episteme UI. */
  permissionManager: WebSocketPermissionManager;
  /** Names of mode-gated plugins currently active. Mutate via activatePlugin/deactivatePlugin. */
  activePlugins: Set<string>;
  /** All mode-gated plugin names that exist (active or not). */
  availablePlugins: readonly string[];
  /** Activate a single mode-gated plugin by name. Returns true if the set changed. */
  activatePlugin: (name: string) => boolean;
  /** Deactivate a single mode-gated plugin by name. Returns true if the set changed. */
  deactivatePlugin: (name: string) => boolean;
  isPluginActive: (name: string) => boolean;
  /** Optional listener fired after any activation set change. */
  onActiveChange?: (active: string[]) => void;
}

export function createEpistemAgent(
  workspaceRoot: string,
  config: EpistemeConfig,
): EpistemeAgentBundle {
  // Don't use featureModel() here: it would fall back to the chat default,
  // and the chat model is never an embedder. Leave undefined when unset so
  // OllamaProvider's built-in default ("nomic-embed-text") is used.
  const llm = createProvider(config.models.default, config.models.embedding);
  const dbPath = workspaceDbPath(workspaceRoot);
  const workspaceDb = new WorkspaceDb(dbPath);

  // The send callback is patched in by the server once a client connects.
  // Until then, requests will be auto-denied after the timeout — which is
  // correct: with no UI to prompt, the safe default is "no".
  const permissionManager = new WebSocketPermissionManager(
    workspaceRoot,
    config.permissions,
    () => {
      /* no client yet — server.ts will replace this via setSend() */
    },
  );

  const agent = new CortexAgent(llm, {
    name: "Episteme",
    cortexName: "episteme",
    model: config.models.default,
    memoryDbPath: dbPath,
    systemPrompt: SYSTEM_PROMPT,
    heartbeatInterval: 5000,
    permissionManager,
  });

  // Shared active-plugin set — mutated by activate/deactivate, read by
  // every ModeGated wrapper on each tick so changes take effect without
  // restarting the agent.
  const activePlugins = new Set<string>();

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
  // but their tool surface and system-prompt fragments are suppressed unless
  // their name is in `activePlugins`.
  agent.registerPlugin(new ModeGated(styleGuide, activePlugins));
  agent.registerPlugin(new ModeGated(citation, activePlugins));
  agent.registerPlugin(new ModeGated(diagram, activePlugins));
  agent.registerPlugin(aiFill); // zero tools, no fragment — no need to gate
  agent.registerPlugin(new ModeGated(contradiction, activePlugins));

  const bundle: EpistemeAgentBundle = {
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
    permissionManager,
    activePlugins,
    availablePlugins: MODE_GATED_PLUGIN_NAMES,
    activatePlugin(name: string) {
      if (activePlugins.has(name)) return false;
      activePlugins.add(name);
      agent.invalidateToolCache();
      bundle.onActiveChange?.([...activePlugins]);
      return true;
    },
    deactivatePlugin(name: string) {
      if (!activePlugins.delete(name)) return false;
      agent.invalidateToolCache();
      bundle.onActiveChange?.([...activePlugins]);
      return true;
    },
    isPluginActive(name: string) {
      return activePlugins.has(name);
    },
  };

  return bundle;
}
