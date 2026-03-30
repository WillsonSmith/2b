import { randomUUID } from "crypto";
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

const SYSTEM_TOOLS = new Set(["introspect", "memory_status", "show_active_rules"]);

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

  constructor(
    private memoryPlugin: CortexMemoryPlugin,
    options?: { toolSaturationThreshold?: number },
  ) {
    this.saturationThreshold = options?.toolSaturationThreshold ?? 5;
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
        // Capture search metadata side-channel (available after execution completes)
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
      {
        name: "introspect",
        description:
          "Returns the full current turn state including all tool calls, memory access count, active rules, and uncertainty markers.",
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
    ];
  }

  async executeTool(name: string, _args: Record<string, unknown>): Promise<unknown> {
    try {
      if (name === "introspect") return this.handleIntrospect();
      if (name === "memory_status") return this.handleMemoryStatus();
      if (name === "show_active_rules") return this.handleShowActiveRules();
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
        // non-critical — leave behavioral_rules_active empty
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
}
