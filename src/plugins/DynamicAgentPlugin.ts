import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { PermissionManager } from "../core/PermissionManager.ts";
import { HeadlessAgent } from "../core/HeadlessAgent.ts";
import { CortexSubAgent } from "../core/CortexSubAgent.ts";
import { InMemoryDatabasePlugin } from "./InMemoryDatabasePlugin.ts";
import { WebSearchPlugin } from "./WebSearchPlugin.ts";
import { WebReaderPlugin } from "./WebReaderPlugin.ts";
import { FileSystemPlugin } from "./FileSystemPlugin.ts";
import { ShellPlugin } from "./ShellPlugin.ts";
import { WikipediaPlugin } from "./WikipediaPlugin.ts";
import { RSSPlugin } from "./RSSPlugin.ts";
import { WeatherPlugin } from "./WeatherPlugin.ts";
import { TMDBPlugin } from "./TMDBPlugin.ts";
import { DownloadPlugin } from "./DownloadPlugin.ts";
import { ClipboardPlugin } from "./ClipboardPlugin.ts";
import { NotesPlugin } from "./NotesPlugin.ts";
import { ScratchPlugin } from "./ScratchPlugin.ts";
import { ImageVisionPlugin } from "./ImageVisionPlugin.ts";
import { YtDlpPlugin } from "./YtDlpPlugin.ts";
import { FFmpegPlugin } from "./FFmpegPlugin.ts";
import { CodeSandboxPlugin } from "./CodeSandboxPlugin.ts";
import { BunSandboxPlugin } from "./BunSandboxPlugin.ts";
import { SourceReaderPlugin } from "./SourceReaderPlugin.ts";
import { logger } from "../logger.ts";
import type { CortexMemoryPlugin } from "./CortexMemoryPlugin.ts";
import { ParentMemoryBridgePlugin } from "./ParentMemoryBridgePlugin.ts";

// ── Capability registry ───────────────────────────────────────────────────────

/**
 * A capability entry describes a named plugin bundle available to headless agents.
 * The `description` appears in list_capabilities output and should tell the AI
 * what kinds of tasks this capability enables.
 */
interface CapabilityDef {
  description: string;
  build: (options: PluginBuildOptions) => AgentPlugin[];
}

/** Options forwarded from DynamicAgentPlugin constructor to per-capability builders. */
interface PluginBuildOptions {
  sourceRoot?: string;
  visionModel?: string;
  visionBaseUrl?: string;
}

const CAPABILITY_REGISTRY: Record<string, CapabilityDef> = {
  web: {
    description: "Web search (DuckDuckGo) and full webpage reading.",
    build: () => [new WebSearchPlugin(), new WebReaderPlugin()],
  },
  files: {
    description:
      "Local filesystem: read, write, list, move, copy, delete, glob. Paths sandboxed to working directory.",
    build: () => [new FileSystemPlugin()],
  },
  shell: {
    description:
      "Read-only shell commands: git, ls, cat, grep, df, ps. No write operators.",
    build: () => [new ShellPlugin()],
  },
  wikipedia: {
    description:
      "Search and read Wikipedia articles, list sections, follow links.",
    build: () => [new WikipediaPlugin()],
  },
  rss: {
    description: "Fetch and parse RSS and Atom feeds (HTTPS only).",
    build: () => [new RSSPlugin()],
  },
  weather: {
    description:
      "Current weather conditions for any location via Open-Meteo. No API key required.",
    build: () => [new WeatherPlugin()],
  },
  tmdb: {
    description:
      "Movie and TV show lookup, cast, credits, recommendations via The Movie Database. Requires TMDB_API_KEY.",
    build: () => [new TMDBPlugin()],
  },
  download: {
    description:
      "Download files from HTTPS URLs to the local downloads/ directory. Max 100 MB.",
    build: () => [new DownloadPlugin()],
  },
  clipboard: {
    description: "Read and write the macOS clipboard (pbpaste/pbcopy).",
    build: () => [new ClipboardPlugin()],
  },
  notes: {
    description:
      "Create, list, read, and delete persistent markdown notes in the notes/ directory.",
    build: () => [new NotesPlugin()],
  },
  scratch: {
    description:
      "Session-scoped scratch pad: save and retrieve text snippets by name across turns.",
    build: () => [new ScratchPlugin()],
  },
  image_vision: {
    description:
      "Analyze images from URLs or local file paths using a local vision model.",
    build: (opts) => [
      new ImageVisionPlugin(opts.visionModel, opts.visionBaseUrl),
    ],
  },
  media: {
    description:
      "Download video clips (yt-dlp) and edit video files (FFmpeg): trim, convert, extract audio, resize, concatenate. Requires yt-dlp and ffmpeg in PATH.",
    build: () => [new YtDlpPlugin(), new FFmpegPlugin()],
  },
  bun_sandbox: {
    description:
      "Execute TypeScript directly in an isolated Bun container. The agent writes the code itself — no code-gen model. Requires Docker or Apple Container runtime.",
    build: () => [new BunSandboxPlugin()],
  },
  source_reader: {
    description:
      "Read-only access to this agent's own source code: read files, browse directories, grep for definitions.",
    build: (opts) => [new SourceReaderPlugin({ sourceRoot: opts.sourceRoot })],
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface AskableAgent {
  ask(task: string): Promise<string>;
  setToolCallHandler(
    fn: (name: string, args: Record<string, unknown>) => void,
  ): void;
}

type AgentType = "headless" | "cortex";

interface DynamicAgentEntry {
  agent: AskableAgent;
  type: AgentType;
  capabilities: string[];
  createdAt: Date;
}

/** A preset is a headless agent created automatically at plugin init time. */
export interface AgentPreset {
  system_prompt: string;
  capabilities: string[];
}

interface DynamicAgentPluginOptions {
  permissionManager?: PermissionManager;
  /** The model identifier used by the LLM provider (passed through to spawned cortex agents). */
  model?: string;
  /** Forwarded to SourceReaderPlugin when the "source_reader" capability is used. */
  sourceRoot?: string;
  /** Forwarded to ImageVisionPlugin when the "image_vision" capability is used. */
  visionModel?: string;
  visionBaseUrl?: string;
  /**
   * Agents to create immediately at plugin initialization.
   * Each key becomes the agent name; value defines the system prompt and capabilities.
   * These headless agents are available via call_agent before the AI ever calls create_agent.
   */
  presets?: Record<string, AgentPreset>;
  /**
   * If provided, cortex sub-agents will receive a ParentMemoryBridgePlugin that
   * allows them to persist facts and procedures to this parent memory store.
   */
  parentMemory?: CortexMemoryPlugin;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

/**
 * Allows the orchestrator to spawn and call sub-agents at runtime.
 *
 * Two agent types:
 * - "headless": Lightweight, stateless. Each call is independent. Good for isolated tasks.
 *   Supports any combination of capability plugins plus a built-in KV store.
 * - "cortex": Full CortexAgent with persistent in-memory semantic memory, conversation
 *   history, and thought/behavior persistence across calls. Good for ongoing collaboration.
 *
 * Preset agents (configured via the `presets` option) are created as headless agents
 * at init time and are immediately available via call_agent.
 */
export class DynamicAgentPlugin implements AgentPlugin {
  name = "DynamicAgent";
  private parentAgent?: BaseAgent;
  private readonly registry = new Map<string, DynamicAgentEntry>();
  private readonly llm: LLMProvider;
  private readonly permissionManager?: PermissionManager;
  private readonly model: string;
  private readonly pluginBuildOptions: PluginBuildOptions;
  private readonly presets: Record<string, AgentPreset>;
  private readonly parentMemory: CortexMemoryPlugin | undefined;

  constructor(llm: LLMProvider, options: DynamicAgentPluginOptions = {}) {
    this.llm = llm;
    this.permissionManager = options.permissionManager;
    this.model = options.model ?? "";
    this.presets = options.presets ?? {};
    this.parentMemory = options.parentMemory;
    this.pluginBuildOptions = {
      sourceRoot: options.sourceRoot,
      visionModel: options.visionModel,
      visionBaseUrl: options.visionBaseUrl,
    };
  }

  onInit(agent: BaseAgent): void {
    this.parentAgent = agent;

    for (const [name, preset] of Object.entries(this.presets)) {
      try {
        this.spawnAgent(
          name,
          preset.system_prompt,
          "headless",
          preset.capabilities,
        );
        logger.info("DynamicAgent", `Preset agent "${name}" ready`);
      } catch (e) {
        logger.error(
          "DynamicAgent",
          `Failed to create preset agent "${name}":`,
          e,
        );
      }
    }
  }

  getSystemPromptFragment(): string {
    const presetNames = Object.keys(this.presets);
    const presetLine =
      presetNames.length > 0
        ? `Pre-created agents available immediately: ${presetNames.join(", ")}.`
        : "";

    return [
      "You can spawn and call specialized sub-agents at runtime.",
      presetLine,
      "- list_agents: See all active agents (pre-created and dynamically spawned).",
      "- list_capabilities: See all plugin capabilities you can give new agents.",
      "- create_agent: Spawn a new agent with a custom system prompt and capability set.",
      "- call_agent: Send a task to any agent. Pre-created agents are available immediately.",
      "",
      'Use "headless" agents for isolated, one-shot tasks. Use "cortex" agents when the agent needs to remember context across multiple calls.',
    ]
      .filter(Boolean)
      .join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "list_capabilities",
        description:
          "List all plugin capabilities available when creating headless agents, with a short description of each.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "create_agent",
        description:
          'Spawn a new sub-agent with a custom system prompt and capability set. Use "headless" for lightweight one-shot tasks or "cortex" for a persistent collaborator that remembers context across multiple call_agent invocations.',
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Unique name for this agent (letters, numbers, underscores only). Used to call it later.",
            },
            system_prompt: {
              type: "string",
              description:
                "The system prompt defining this agent's role, behavior, and constraints. Be specific — this is the agent's full instruction set.",
            },
            agent_type: {
              type: "string",
              enum: ["headless", "cortex"],
              description:
                '"headless": stateless, one-shot, lightweight. "cortex": persistent memory, conversation history, semantic search across calls.',
            },
            capabilities: {
              type: "array",
              items: { type: "string" },
              description:
                "Plugin capabilities for this agent. Use list_capabilities to see options. Ignored for cortex agents (they use their built-in memory stack). Always included for headless agents: a KV store (agent_memory_set/get/delete/list).",
            },
          },
          required: ["name", "system_prompt", "agent_type"],
        },
      },
      {
        name: "call_agent",
        description:
          "Send a task to a previously spawned agent and get its response. Headless agents process each call independently. Cortex agents accumulate memory and context across calls.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the agent to call.",
            },
            task: {
              type: "string",
              description:
                "The task or question for the agent. Include all relevant context — agents have no access to your conversation history, only their own.",
            },
          },
          required: ["name", "task"],
        },
      },
      {
        name: "list_agents",
        description:
          "List all active agents: pre-created presets and dynamically spawned ones.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ];
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    switch (name) {
      case "list_capabilities":
        return this.listCapabilities();
      case "create_agent":
        return this.spawnAgent(
          args.name as string,
          args.system_prompt as string,
          args.agent_type as AgentType,
          (args.capabilities as string[] | undefined) ?? [],
        );
      case "call_agent":
        return this.callAgent(args.name as string, args.task as string);
      case "list_agents":
        return this.listAgents();
      default:
        return undefined;
    }
  }

  private listCapabilities(): unknown {
    const capabilities = Object.entries(CAPABILITY_REGISTRY).map(
      ([key, def]) => ({
        name: key,
        description: def.description,
      }),
    );
    return { capabilities };
  }

  private spawnAgent(
    name: string,
    systemPrompt: string,
    agentType: AgentType,
    capabilities: string[],
  ): unknown {
    if (!/^[a-zA-Z0-9_]+$/.test(name)) {
      throw new Error(
        `Invalid agent name "${name}". Use letters, numbers, and underscores only.`,
      );
    }
    if (this.registry.has(name)) {
      throw new Error(
        `Agent "${name}" already exists. Use list_agents to see existing agents or choose a different name.`,
      );
    }
    if (agentType !== "headless" && agentType !== "cortex") {
      throw new Error(
        `Invalid agent_type "${agentType}". Must be "headless" or "cortex".`,
      );
    }

    const agent =
      agentType === "cortex"
        ? this.buildCortexAgent(name, systemPrompt)
        : this.buildHeadlessAgent(name, systemPrompt, capabilities);

    if (this.parentAgent) {
      const parent = this.parentAgent;

      agent.setToolCallHandler((toolName, toolArgs) => {
        parent.emit(
          "subagent_tool_call",
          name,
          "call_agent",
          toolName,
          toolArgs,
        );
      });

      if (agentType === "cortex") {
        const cortexAgent = agent as CortexSubAgent;
        cortexAgent.setStateChangeHandler((state) => {
          parent.emit("agent_state_change", name, state);
        });
        cortexAgent.setErrorHandler((err) => {
          parent.emit("agent_error", name, err);
        });
      }

      parent.emit("agent_spawned", name, agentType, capabilities);
    }

    this.registry.set(name, {
      agent,
      type: agentType,
      capabilities,
      createdAt: new Date(),
    });
    logger.info(
      "DynamicAgent",
      `Spawned ${agentType} agent "${name}" caps=[${capabilities.join(", ")}]`,
    );
    return { created: name, type: agentType };
  }

  private buildCortexAgent(name: string, systemPrompt: string): CortexSubAgent {
    const agent = new CortexSubAgent(
      this.llm,
      {
        name,
        cortexName: name,
        model: this.model,
        systemPrompt,
        permissionManager: this.permissionManager,
      },
      { permissionManager: this.permissionManager },
    );
    if (this.parentMemory) {
      agent.registerPlugin(
        new ParentMemoryBridgePlugin(this.parentMemory, name),
      );
    }
    return agent;
  }

  private buildHeadlessAgent(
    name: string,
    systemPrompt: string,
    capabilities: string[],
  ): HeadlessAgent {
    // Always include the KV store so headless agents can track state within a call.
    const plugins: AgentPlugin[] = [new InMemoryDatabasePlugin()];

    const unknownCaps: string[] = [];
    for (const cap of capabilities) {
      const def = CAPABILITY_REGISTRY[cap];
      if (!def) {
        unknownCaps.push(cap);
        continue;
      }
      plugins.push(...def.build(this.pluginBuildOptions));
    }

    if (unknownCaps.length > 0) {
      logger.warn(
        "DynamicAgent",
        `Unknown capabilities for agent "${name}" (ignored): ${unknownCaps.join(", ")}. Use list_capabilities to see valid options.`,
      );
    }

    return new HeadlessAgent(this.llm, plugins, systemPrompt, {
      agentName: name,
      permissionManager: this.permissionManager,
    });
  }

  private async callAgent(name: string, task: string): Promise<unknown> {
    const entry = this.registry.get(name);
    if (!entry) {
      const available = Array.from(this.registry.keys()).join(", ") || "none";
      throw new Error(
        `Agent "${name}" not found. Available agents: ${available}. Use list_agents for details.`,
      );
    }
    logger.debug("DynamicAgent", `Calling ${entry.type} agent "${name}"`);
    return entry.agent.ask(task);
  }

  private listAgents(): unknown {
    const agents = Array.from(this.registry.entries()).map(
      ([agentName, entry]) => ({
        name: agentName,
        type: entry.type,
        capabilities: entry.capabilities,
        createdAt: entry.createdAt.toISOString(),
      }),
    );
    return { agents };
  }
}
