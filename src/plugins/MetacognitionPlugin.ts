import { randomUUID } from "crypto";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { Message } from "../core/types.ts";
import type { CortexMemoryPlugin } from "./CortexMemoryPlugin.ts";

const MEMORY_TOOLS = new Set([
  "search_memory", "query_memories", "hybrid_search",
  "save_memory", "save_behavior", "save_procedure", "edit_memory", "delete_memory",
  "get_linked_memories", "aggregate_memories", "get_memory_timeline",
]);

const EXTERNAL_TOOLS = new Set([
  "web_search", "read_webpage", "download_file", "run_shell",
  "download_video_clip", "fetch_rss_feed",
  "ffmpeg_get_info", "ffmpeg_trim", "ffmpeg_convert", "ffmpeg_extract_audio",
  "ffmpeg_resize", "ffmpeg_concatenate", "ffmpeg_images_to_video", "ffmpeg_add_audio",
  "ffmpeg_extract_frames", "ffmpeg_screenshot", "ffmpeg_crop", "ffmpeg_speed", "ffmpeg_rotate",
]);

const SYSTEM_TOOLS = new Set([
  "introspect", "memory_status", "show_active_rules",
  "list_registered_plugins", "list_available_tools", "get_system_prompt",
  "read_source_file", "list_source_dir", "grep_source",
]);

interface ToolCallRecord {
  tool: string;
  args_summary: string;
  category: "memory" | "external" | "system" | "other";
  timestamp: Date;
  result_meta?: Record<string, unknown>;
}

interface TurnState {
  turn_id: string;
  started_at: Date;
  tool_calls: ToolCallRecord[];
  memory_access_count: number;
  external_tool_count: number;
  behavioral_rules_active: string[];
  uncertainty_markers: string[];
}

function categorize(tool: string): ToolCallRecord["category"] {
  if (MEMORY_TOOLS.has(tool)) return "memory";
  if (EXTERNAL_TOOLS.has(tool)) return "external";
  if (SYSTEM_TOOLS.has(tool)) return "system";
  return "other";
}

export class MetacognitionPlugin implements AgentPlugin {
  name = "Metacognition";
  private currentTurn: TurnState;
  private readonly saturationThreshold: number;
  private readonly sourceRoot: string;
  private agentRef: BaseAgent | null = null;

  constructor(
    private memoryPlugin: CortexMemoryPlugin,
    options?: { toolSaturationThreshold?: number; sourceRoot?: string },
  ) {
    this.saturationThreshold = options?.toolSaturationThreshold ?? 5;
    this.sourceRoot = resolve(options?.sourceRoot ?? process.cwd());
    this.currentTurn = this.newTurn();
  }

  private newTurn(): TurnState {
    return {
      turn_id: randomUUID(),
      started_at: new Date(),
      tool_calls: [],
      memory_access_count: 0,
      external_tool_count: 0,
      behavioral_rules_active: [],
      uncertainty_markers: [],
    };
  }

  onInit(agent: BaseAgent): void {
    this.agentRef = agent;

    agent.on("tool_call", (name: string, args: Record<string, unknown>) => {
      const category = categorize(name);
      const record: ToolCallRecord = {
        tool: name,
        args_summary: JSON.stringify(args).slice(0, 100),
        category,
        timestamp: new Date(),
      };
      this.currentTurn.tool_calls.push(record);

      if (category === "memory") {
        this.currentTurn.memory_access_count++;
        if (
          this.currentTurn.memory_access_count > this.saturationThreshold &&
          !this.currentTurn.uncertainty_markers.includes("tool_saturation")
        ) {
          this.currentTurn.uncertainty_markers.push("tool_saturation");
        }
        const meta = this.memoryPlugin.searchMetaBuffer.get(name);
        if (meta) record.result_meta = meta;
      } else if (category === "external") {
        this.currentTurn.external_tool_count++;
      }
    });
  }

  getSystemPromptFragment(): string {
    return (
      "You have metacognition tools available. Before searching memory, state your intent with " +
      "[Memory Search: <query>]. After tool-heavy turns, reflect on whether your reasoning relied " +
      "on retrieval or inference. Use the introspect tool to examine your current cognitive state. " +
      "Use read_source_file, list_source_dir, and grep_source to read your own implementation code. " +
      "Flag assumptions explicitly rather than presenting them as facts."
    );
  }

  getContext(): string {
    const t = this.currentTurn;
    const lastTool = t.tool_calls.at(-1)?.tool ?? "none";
    const rules = t.behavioral_rules_active.length > 0
      ? t.behavioral_rules_active.join(", ")
      : "none";
    const markers = t.uncertainty_markers.length > 0
      ? t.uncertainty_markers.join(", ")
      : "none";
    const saturationWarning = t.uncertainty_markers.includes("tool_saturation")
      ? " (TOOL SATURATION)"
      : "";

    return [
      "[Metacognition]",
      `Turn: ${t.turn_id.slice(0, 8)}`,
      `Memory accesses this turn: ${t.memory_access_count}${saturationWarning}`,
      `Active behavioral rules: ${rules}`,
      `Last tool: ${lastTool}`,
      `Uncertainty: ${markers}`,
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      // --- Cognitive state ---
      {
        name: "introspect",
        description:
          "Returns the full current turn state: all tool calls, memory access count, active rules, and uncertainty markers.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "memory_status",
        description:
          "Returns memory counts by type (factual, thought, behavior, procedure) and current turn memory access stats.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "show_active_rules",
        description:
          "Retrieves all behavior memories (the active behavioral rules currently injected into your system prompt) with their tags and creation dates.",
        parameters: { type: "object", properties: {} },
      },
      // --- Runtime self-inspection ---
      {
        name: "list_registered_plugins",
        description:
          "Lists all plugins currently registered with the agent, showing each plugin's name and number of tools it exposes.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "list_available_tools",
        description:
          "Lists all tools currently available to the agent across all registered plugins, with their descriptions.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "get_system_prompt",
        description:
          "Returns the full assembled system prompt from the most recent LLM call, showing exactly what instructions the model received.",
        parameters: { type: "object", properties: {} },
      },
      // --- Source code reading ---
      {
        name: "read_source_file",
        description:
          "Reads a source file from the agent's codebase. Path is relative to the project root (e.g. 'src/plugins/MetacognitionPlugin.ts').",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path relative to the project root" },
          },
          required: ["path"],
        },
      },
      {
        name: "list_source_dir",
        description:
          "Lists files and subdirectories at a path relative to the project root. Defaults to the project root if path is omitted.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Directory path relative to the project root (default: project root)",
            },
          },
        },
      },
      {
        name: "grep_source",
        description:
          "Searches the agent's source code for a pattern using ripgrep. Returns matching lines with file paths and line numbers.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regex or literal pattern to search for" },
            path: {
              type: "string",
              description:
                "Directory or file to search within, relative to project root (default: src/)",
            },
            glob: {
              type: "string",
              description: "File glob filter (e.g. '*.ts', default: '*.ts')",
            },
          },
          required: ["pattern"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      if (name === "introspect") return this.handleIntrospect();
      if (name === "memory_status") return this.handleMemoryStatus();
      if (name === "show_active_rules") return this.handleShowActiveRules();
      if (name === "list_registered_plugins") return this.handleListRegisteredPlugins();
      if (name === "list_available_tools") return this.handleListAvailableTools();
      if (name === "get_system_prompt") return this.handleGetSystemPrompt();
      if (name === "read_source_file") return await this.handleReadSourceFile(args);
      if (name === "list_source_dir") return this.handleListSourceDir(args);
      if (name === "grep_source") return await this.handleGrepSource(args);
    } catch (e) {
      console.warn(`[MetacognitionPlugin] Tool error (${name}):`, e);
      return `Tool error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  onMessage(role: Message["role"], content: string): void {
    if (role === "user") {
      this.currentTurn = this.newTurn();
      try {
        const behaviors = this.memoryPlugin.db.getRecentMemories(20, "behavior");
        this.currentTurn.behavioral_rules_active = behaviors.map((b) =>
          b.text.slice(0, 60),
        );
      } catch {
        // non-critical
      }
    } else if (role === "assistant") {
      const hedgePattern =
        /\b(i think|probably|i'm not sure|i believe|might be|may be|i guess|not certain)\b/i;
      if (
        hedgePattern.test(content) &&
        !this.currentTurn.uncertainty_markers.includes("hedged_language")
      ) {
        this.currentTurn.uncertainty_markers.push("hedged_language");
      }
    }
  }

  // ---- Cognitive state handlers ----

  private handleIntrospect(): string {
    const t = this.currentTurn;
    const toolLines =
      t.tool_calls.length > 0
        ? t.tool_calls.map(
            (tc, i) =>
              `  ${i + 1}. [${tc.category}] ${tc.tool} at ${tc.timestamp.toISOString().slice(11, 19)} — args: ${tc.args_summary}`,
          )
        : ["  (none)"];

    return [
      `Turn ID: ${t.turn_id}`,
      `Started: ${t.started_at.toISOString()}`,
      `Memory accesses: ${t.memory_access_count}`,
      `External tool calls: ${t.external_tool_count}`,
      `Active behavioral rules: ${t.behavioral_rules_active.length > 0 ? t.behavioral_rules_active.join("; ") : "none"}`,
      `Uncertainty markers: ${t.uncertainty_markers.length > 0 ? t.uncertainty_markers.join(", ") : "none"}`,
      "",
      `Tool calls this turn (${t.tool_calls.length}):`,
      ...toolLines,
    ].join("\n");
  }

  private handleMemoryStatus(): string {
    try {
      const counts = this.memoryPlugin.db.aggregateMemories("type");
      const t = this.currentTurn;
      const saturationNote = t.uncertainty_markers.includes("tool_saturation")
        ? " (TOOL SATURATION — threshold exceeded)"
        : "";
      return [
        "Memory counts by type:",
        ...counts.map((c) => `  ${c.group}: ${c.count}`),
        "",
        `This turn: ${t.memory_access_count} memory accesses${saturationNote}`,
      ].join("\n");
    } catch (e) {
      return `Error reading memory status: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private handleShowActiveRules(): string {
    try {
      const behaviors = this.memoryPlugin.db.queryMemories({ types: ["behavior"], limit: 50 });
      if (behaviors.length === 0) return "No behavioral rules found.";
      return [
        `Active behavioral rules (${behaviors.length}):`,
        ...behaviors.map((b) => {
          const date = new Date(b.timestamp).toISOString().slice(0, 10);
          const tags = b.tags.length > 0 ? ` [${b.tags.join(", ")}]` : "";
          return `[${b.id.slice(0, 8)}] (${date}${tags}) ${b.text}`;
        }),
      ].join("\n");
    } catch (e) {
      return `Error reading behavioral rules: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // ---- Runtime self-inspection handlers ----

  private handleListRegisteredPlugins(): string {
    if (!this.agentRef) return "Agent not initialised yet.";
    const plugins = this.agentRef.getRegisteredPlugins();
    if (plugins.length === 0) return "No plugins registered.";
    return [
      `Registered plugins (${plugins.length}):`,
      ...plugins.map((p) => `  ${p.name} — ${p.toolCount} tool${p.toolCount !== 1 ? "s" : ""}`),
    ].join("\n");
  }

  private handleListAvailableTools(): string {
    if (!this.agentRef) return "Agent not initialised yet.";
    const tools = this.agentRef.getAvailableTools();
    if (tools.length === 0) return "No tools available.";
    return [
      `Available tools (${tools.length}):`,
      ...tools.map((t) => `  ${t.name} — ${t.description}`),
    ].join("\n");
  }

  private handleGetSystemPrompt(): string {
    if (!this.agentRef) return "Agent not initialised yet.";
    const prompt = this.agentRef.getLastSystemPrompt();
    if (!prompt) return "No system prompt recorded yet (agent hasn't completed a turn).";
    return `System prompt (${prompt.length} chars):\n\n${prompt}`;
  }

  // ---- Source code reading handlers ----

  /** Resolve a user-supplied relative path safely within sourceRoot. Returns null if unsafe. */
  private resolveSafe(userPath: string): string | null {
    const abs = resolve(this.sourceRoot, userPath);
    if (!abs.startsWith(this.sourceRoot)) return null;
    return abs;
  }

  private async handleReadSourceFile(args: Record<string, unknown>): Promise<string> {
    const userPath = String(args.path ?? "");
    if (!userPath) return "path is required.";
    const abs = this.resolveSafe(userPath);
    if (!abs) return `Path '${userPath}' is outside the project root.`;
    if (!existsSync(abs)) return `File not found: ${userPath}`;
    const stat = statSync(abs);
    if (stat.isDirectory()) return `'${userPath}' is a directory. Use list_source_dir instead.`;
    if (stat.size > 500_000) return `File too large (${stat.size} bytes). Max 500 KB.`;
    const content = readFileSync(abs, "utf8");
    return `// ${userPath} (${stat.size} bytes)\n${content}`;
  }

  private handleListSourceDir(args: Record<string, unknown>): string {
    const userPath = String(args.path ?? "");
    const abs = this.resolveSafe(userPath || ".");
    if (!abs) return `Path '${userPath}' is outside the project root.`;
    if (!existsSync(abs)) return `Directory not found: ${userPath || "(project root)"}`;
    const stat = statSync(abs);
    if (!stat.isDirectory()) return `'${userPath}' is a file. Use read_source_file instead.`;

    const entries = readdirSync(abs);
    const lines = entries
      .map((entry) => {
        const full = join(abs, entry);
        const isDir = statSync(full).isDirectory();
        const relPath = relative(this.sourceRoot, full);
        return isDir ? `  ${entry}/  (${relPath})` : `  ${entry}  (${relPath})`;
      })
      .sort();

    const displayPath = userPath || "(project root)";
    return [`${displayPath} — ${entries.length} entries:`, ...lines].join("\n");
  }

  private async handleGrepSource(args: Record<string, unknown>): Promise<string> {
    const pattern = String(args.pattern ?? "");
    if (!pattern) return "pattern is required.";
    const userPath = String(args.path ?? "src");
    const glob = String(args.glob ?? "*.ts");

    const abs = this.resolveSafe(userPath);
    if (!abs) return `Path '${userPath}' is outside the project root.`;
    if (!existsSync(abs)) return `Path not found: ${userPath}`;

    try {
      const result =
        await Bun.$`rg ${pattern} ${abs} --glob ${glob} --line-number --no-heading --max-count 5 --max-filesize 500K`.text();
      if (!result.trim()) return `No matches for '${pattern}' in ${userPath}`;
      // Make paths relative to sourceRoot for readability
      const lines = result
        .split("\n")
        .filter(Boolean)
        .map((line) => line.replace(abs + "/", "").replace(this.sourceRoot + "/", ""));
      return `Matches for '${pattern}' in ${userPath} (glob: ${glob}):\n${lines.join("\n")}`;
    } catch {
      return `No matches for '${pattern}' in ${userPath}`;
    }
  }
}
