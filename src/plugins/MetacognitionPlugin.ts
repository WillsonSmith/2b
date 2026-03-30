import { randomUUID } from "crypto";
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { Message } from "../core/types.ts";
import type { CortexMemoryPlugin } from "./CortexMemoryPlugin.ts";
import { SourceReaderPlugin } from "./SourceReaderPlugin.ts";

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

const SOURCE_TOOLS = new Set(["read_source_file", "list_source_dir", "grep_source"]);

const SYSTEM_TOOLS = new Set([
  "introspect", "memory_status", "show_active_rules",
  "list_registered_plugins", "list_available_tools", "get_system_prompt",
  "efficiency_report",
  ...SOURCE_TOOLS,
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
  ended_at?: Date;
  tool_calls: ToolCallRecord[];
  memory_access_count: number;
  external_tool_count: number;
  behavioral_rules_active: string[];
  uncertainty_markers: string[];
}

const TURN_HISTORY_LIMIT = 20;

function categorize(tool: string): ToolCallRecord["category"] {
  if (MEMORY_TOOLS.has(tool)) return "memory";
  if (EXTERNAL_TOOLS.has(tool)) return "external";
  if (SYSTEM_TOOLS.has(tool)) return "system";
  return "other";
}

export class MetacognitionPlugin implements AgentPlugin {
  name = "Metacognition";
  private currentTurn: TurnState;
  private turnHistory: TurnState[] = [];
  private readonly saturationThreshold: number;
  private readonly sourceReader: SourceReaderPlugin;
  private agentRef: BaseAgent | null = null;

  constructor(
    private memoryPlugin: CortexMemoryPlugin,
    options?: { toolSaturationThreshold?: number; sourceRoot?: string },
  ) {
    this.saturationThreshold = options?.toolSaturationThreshold ?? 5;
    this.sourceReader = new SourceReaderPlugin({ sourceRoot: options?.sourceRoot });
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
        if (meta) {
          record.result_meta = meta;
          this.memoryPlugin.searchMetaBuffer.delete(name);
        }
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
      "Use efficiency_report to analyze your own tool-use patterns and identify redundancy or overuse. " +
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

    const parts = [
      "[Metacognition]",
      `Turn: ${t.turn_id.slice(0, 8)}`,
      `Memory accesses this turn: ${t.memory_access_count}${saturationWarning}`,
      `Active behavioral rules: ${rules}`,
      `Last tool: ${lastTool}`,
      `Uncertainty: ${markers}`,
    ];

    if (t.uncertainty_markers.includes("tool_saturation")) {
      parts.push(
        "DIRECTIVE: Memory search threshold exceeded. Do not call search_memory or hybrid_search again this turn. Synthesize from what is already retrieved.",
      );
    }
    if (t.uncertainty_markers.includes("hedged_language")) {
      parts.push(
        "DIRECTIVE: You hedged your last response. Retrieve a specific memory that resolves the uncertainty, or explicitly state the information is not in memory.",
      );
    }

    return parts.join("\n");
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
      // --- Efficiency analysis ---
      {
        name: "efficiency_report",
        description:
          "Analyzes your own tool-use patterns across recent turns and the current turn. " +
          "Identifies redundant calls, dead searches, saturation events, and hedging frequency. " +
          "Use this to understand your own cognitive inefficiencies in concrete, measurable terms.",
        parameters: { type: "object", properties: {} },
      },
      // --- Source code reading (delegated to SourceReaderPlugin) ---
      ...this.sourceReader.getTools(),
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
      if (name === "efficiency_report") return this.handleEfficiencyReport();
      if (SOURCE_TOOLS.has(name)) return await this.sourceReader.executeTool(name, args);
    } catch (e) {
      console.warn(`[MetacognitionPlugin] Tool error (${name}):`, e);
      return `Tool error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  onMessage(role: Message["role"], content: string): void {
    if (role === "user") {
      // Archive the completed turn before starting a new one
      if (this.currentTurn.tool_calls.length > 0) {
        this.currentTurn.ended_at = new Date();
        this.turnHistory.push(this.currentTurn);
        if (this.turnHistory.length > TURN_HISTORY_LIMIT) {
          this.turnHistory.shift();
        }
      }
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

  private handleEfficiencyReport(): string {
    const allTurns = [...this.turnHistory, this.currentTurn].filter(
      (t) => t.tool_calls.length > 0,
    );

    if (allTurns.length === 0) {
      return "No turn data yet. Use some tools first, then call efficiency_report.";
    }

    const sections: string[] = [];

    // ── Current turn analysis ──────────────────────────────────────────────────
    const t = this.currentTurn;
    sections.push("## Current Turn");

    // Redundant calls: same tool called more than once
    const callCounts = new Map<string, ToolCallRecord[]>();
    for (const tc of t.tool_calls) {
      const group = callCounts.get(tc.tool) ?? [];
      group.push(tc);
      callCounts.set(tc.tool, group);
    }
    const redundant = [...callCounts.entries()].filter(([, calls]) => calls.length > 1);
    if (redundant.length > 0) {
      sections.push("**Redundant tool calls** (same tool invoked multiple times this turn):");
      for (const [tool, calls] of redundant) {
        sections.push(`  ${tool} × ${calls.length}`);
        for (const c of calls) {
          sections.push(`    args: ${c.args_summary}`);
        }
      }
    } else {
      sections.push("No redundant tool calls this turn.");
    }

    // Saturation
    if (t.uncertainty_markers.includes("tool_saturation")) {
      sections.push(
        `**Tool saturation**: ${t.memory_access_count} memory accesses exceeded threshold (${this.saturationThreshold}).`,
      );
    }

    // Hedging
    if (t.uncertainty_markers.includes("hedged_language")) {
      sections.push("**Hedged language detected** in this turn's response — possible low confidence.");
    }

    // Tool mix
    const byCategory = new Map<string, number>();
    for (const tc of t.tool_calls) {
      byCategory.set(tc.category, (byCategory.get(tc.category) ?? 0) + 1);
    }
    if (byCategory.size > 0) {
      sections.push(
        "Tool mix: " +
          [...byCategory.entries()].map(([k, v]) => `${k}=${v}`).join(", "),
      );
    }

    // ── Historical analysis ────────────────────────────────────────────────────
    const historical = this.turnHistory;
    if (historical.length > 0) {
      sections.push(`\n## Historical Patterns (last ${historical.length} completed turns)`);

      const avgMemory =
        historical.reduce((s, turn) => s + turn.memory_access_count, 0) / historical.length;
      const avgTools =
        historical.reduce((s, turn) => s + turn.tool_calls.length, 0) / historical.length;
      const saturationCount = historical.filter((turn) =>
        turn.uncertainty_markers.includes("tool_saturation"),
      ).length;
      const hedgeCount = historical.filter((turn) =>
        turn.uncertainty_markers.includes("hedged_language"),
      ).length;

      sections.push(`Average memory accesses per turn: ${avgMemory.toFixed(1)}`);
      sections.push(`Average total tool calls per turn: ${avgTools.toFixed(1)}`);
      sections.push(
        `Saturation events: ${saturationCount}/${historical.length} turns (${Math.round((saturationCount / historical.length) * 100)}%)`,
      );
      sections.push(
        `Hedged responses: ${hedgeCount}/${historical.length} turns (${Math.round((hedgeCount / historical.length) * 100)}%)`,
      );

      // Most-used tools across history
      const toolFreq = new Map<string, number>();
      for (const turn of historical) {
        for (const tc of turn.tool_calls) {
          toolFreq.set(tc.tool, (toolFreq.get(tc.tool) ?? 0) + 1);
        }
      }
      const topTools = [...toolFreq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([tool, count]) => `  ${tool}: ${count} calls`);
      sections.push(`Top tools used:\n${topTools.join("\n")}`);

      // Turns with redundant calls
      const redundantTurns = historical.filter((turn) => {
        const seen = new Set<string>();
        for (const tc of turn.tool_calls) {
          if (seen.has(tc.tool)) return true;
          seen.add(tc.tool);
        }
        return false;
      });
      sections.push(
        `Turns with redundant tool calls: ${redundantTurns.length}/${historical.length}`,
      );
    }

    // ── Suggestions ────────────────────────────────────────────────────────────
    sections.push("\n## Suggestions");
    const suggestions: string[] = [];

    if (redundant.length > 0) {
      suggestions.push(
        "You called the same tool multiple times this turn. Check whether the first result was sufficient before re-querying.",
      );
    }
    const memoryRatio = t.tool_calls.length > 0
      ? t.memory_access_count / t.tool_calls.length
      : 0;
    if (memoryRatio > 0.6 && t.tool_calls.length >= 3) {
      suggestions.push(
        "Over 60% of your tool calls this turn were memory lookups. Consider whether you could have answered from context alone.",
      );
    }
    if (t.uncertainty_markers.includes("hedged_language") && t.memory_access_count === 0) {
      suggestions.push(
        "You hedged your response but didn't search memory. A targeted memory search may have resolved the uncertainty.",
      );
    }
    if (t.uncertainty_markers.includes("hedged_language") && t.memory_access_count > 3) {
      suggestions.push(
        "You searched memory extensively but still hedged. The relevant memory may not exist yet — consider saving what you learn.",
      );
    }
    if (suggestions.length === 0) {
      suggestions.push("No specific inefficiencies detected this turn.");
    }
    sections.push(...suggestions.map((s) => `- ${s}`));

    return sections.join("\n");
  }

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
}
