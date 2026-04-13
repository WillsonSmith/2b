import { randomUUID } from "crypto";
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { Message } from "../core/types.ts";
import type { CortexMemoryPlugin } from "./CortexMemoryPlugin.ts";
import { logger } from "../logger.ts";

interface ToolCallRecord {
  tool: string;
  args_summary: string;
  category: "memory" | "system" | "other";
  timestamp: Date;
  result_meta?: Record<string, unknown>;
}

interface TurnState {
  turn_id: string;
  started_at: Date;
  ended_at?: Date;
  tool_calls: ToolCallRecord[];
  memory_access_count: number;
  behavioral_rules_active: string[];
  uncertainty_markers: string[];
}

const TURN_HISTORY_LIMIT = 20;
const CORRECTION_HISTORY_LIMIT = 50;
const PATTERN_WINDOW = 5;
const PATTERN_THRESHOLD = 3;
const SATURATION_WARNING_RATIO = 0.6;
const USER_UNCERTAINTY_PATTERN =
  /\b(i(?:'m| am) not sure|i don't know|help me figure|i was wondering|i(?:'m| am) unclear|i(?:'m| am) confused|i(?:'m| am) unsure)\b/i;

interface CorrectionRecord {
  id: string;
  trigger: "saturation" | "redundancy" | "hedged_no_search" | "dead_search";
  rule_saved: string;
  behavior_memory_id: string;
  applied_at: Date;
  turns_observed: number;
  effectiveness:
    | "pending"
    | "effective"
    | "ineffective"
    | "effective_after_strengthen"
    | "failed";
  strengthened_at?: Date;
  post_strengthen_count: number;
}

export class MetacognitionPlugin implements AgentPlugin {
  name = "Metacognition";
  private currentTurn: TurnState;
  private turnHistory: TurnState[] = [];
  private correctionHistory: CorrectionRecord[] = [];
  private readonly blockedTools = new Set<string>();
  private readonly saturationThreshold: number;
  private agentRef: BaseAgent | null = null;
  private memoryToolNames = new Set<string>();
  private systemToolNames = new Set<string>();

  constructor(
    private memoryPlugin: CortexMemoryPlugin,
    options?: { toolSaturationThreshold?: number },
  ) {
    // Default raised from 5 → 8; the old value was too aggressive and caused
    // false saturation warnings on normal multi-step turns.
    this.saturationThreshold = options?.toolSaturationThreshold ?? 8;
    this.currentTurn = this.newTurn();
  }

  private newTurn(): TurnState {
    return {
      turn_id: randomUUID(),
      started_at: new Date(),
      tool_calls: [],
      memory_access_count: 0,
      behavioral_rules_active: [],
      uncertainty_markers: [],
    };
  }

  onInit(agent: BaseAgent): void {
    this.agentRef = agent;

    // Build category sets from live plugin state rather than hardcoded lists
    for (const t of this.memoryPlugin.getTools()) {
      this.memoryToolNames.add(t.name);
    }
    for (const t of this.getTools()) {
      this.systemToolNames.add(t.name);
    }

    // Reconstruct correction history from DB so effectiveness state survives restarts
    try {
      const CROSS_SESSION_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
      const existing = this.memoryPlugin.db.queryMemories({
        types: ["behavior"],
        tags: ["metacognition-correction"],
        limit: CORRECTION_HISTORY_LIMIT,
      });
      for (const mem of existing) {
        const trigger = (mem.tags as string[]).find(
          (t) =>
            t !== "metacognition-correction" &&
            !t.startsWith("metacognition-correction:"),
        );
        if (
          !trigger ||
          !["saturation", "redundancy", "hedged_no_search", "dead_search"].includes(trigger)
        )
          continue;

        const isIneffective = (mem.tags as string[]).includes(
          "metacognition-correction:ineffective",
        );
        const age = Date.now() - new Date(mem.timestamp).getTime();

        if (isIneffective && age > CROSS_SESSION_STALE_MS) {
          // Prune stale ineffective corrections from a prior session;
          // drop .catch() — deleteMemory is sync, outer try/catch handles errors
          this.memoryPlugin.db.deleteMemory(mem.id);
          continue;
        }

        this.correctionHistory.push({
          id: randomUUID(),
          trigger: trigger as CorrectionRecord["trigger"],
          rule_saved: mem.text,
          behavior_memory_id: mem.id,
          applied_at: new Date(mem.timestamp),
          turns_observed: 0,
          effectiveness: isIneffective ? "ineffective" : "pending",
          post_strengthen_count: isIneffective ? 1 : 0,
        });
      }
    } catch {
      // non-critical — corrections are best-effort
    }

    agent.on("tool_call", (name: string, args: Record<string, unknown>) => {
      const category = this.categorize(name);
      // Redact known-sensitive argument keys before storing in turn history
      const redacted: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        redacted[k] = /^(password|token|key|secret|auth|credential)s?$/i.test(k)
          ? "[redacted]"
          : v;
      }
      let argsSummary: string;
      try {
        argsSummary = JSON.stringify(redacted).slice(0, 100);
      } catch {
        argsSummary = "[unserializable]";
      }
      const record: ToolCallRecord = {
        tool: name,
        args_summary: argsSummary,
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
          this.blockedTools.add("search_memory");
          this.blockedTools.add("hybrid_search");
          this.blockedTools.add("query_memories");
        }
        const meta = this.memoryPlugin.searchMetaBuffer.get(name);
        if (meta) {
          record.result_meta = meta as unknown as Record<string, unknown>;
          this.memoryPlugin.searchMetaBuffer.delete(name);
        }
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
    const rules =
      t.behavioral_rules_active.length > 0
        ? t.behavioral_rules_active.join(", ")
        : "none";
    const markers =
      t.uncertainty_markers.length > 0
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

    const warningThreshold = Math.ceil(this.saturationThreshold * SATURATION_WARNING_RATIO);
    const isSaturated = t.uncertainty_markers.includes("tool_saturation");
    const isApproaching = !isSaturated && t.memory_access_count >= warningThreshold;

    if (isApproaching) {
      parts.push(
        `APPROACHING SATURATION: ${t.memory_access_count}/${this.saturationThreshold} memory accesses used. ` +
        `Synthesize from retrieved context where possible rather than issuing additional memory searches.`,
      );
    }

    if (isSaturated) {
      const prevTurnAlsoSaturated =
        this.turnHistory
          .at(-1)
          ?.uncertainty_markers.includes("tool_saturation") ?? false;
      if (prevTurnAlsoSaturated) {
        parts.push(
          "HARD STOP: Memory search threshold has been exceeded across multiple consecutive turns. You MUST NOT call search_memory, hybrid_search, or query_memories this turn. Synthesize entirely from already-retrieved context.",
        );
      } else {
        parts.push(
          "DIRECTIVE: Memory search threshold exceeded. Do not call search_memory or hybrid_search again this turn. Synthesize from what is already retrieved.",
        );
      }
    }
    if (t.uncertainty_markers.includes("hedged_language")) {
      parts.push(
        "DIRECTIVE: You hedged your last response. Retrieve a specific memory that resolves the uncertainty, or explicitly state the information is not in memory.",
      );
    }
    if (t.uncertainty_markers.includes("user_query_uncertain")) {
      parts.push(
        "DIRECTIVE: User query contains uncertainty signals. Search memory before responding rather than hedging.",
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
          "Returns the full assembled system prompt from the most recent LLM call, showing exactly what instructions the model received. NOTE: output may contain sensitive behavioral rules or injected correction text.",
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
      // --- Self-correction ---
      {
        name: "show_corrections",
        description:
          "Shows the history of self-corrections the agent has autonomously applied, including what pattern triggered each correction and what behavioral rule was saved as a result.",
        parameters: { type: "object", properties: {} },
      },
    ];
  }

  async executeTool(
    name: string,
    _args: Record<string, unknown>,
  ): Promise<unknown> {
    const handlers: Record<string, () => unknown> = {
      introspect: () => this.handleIntrospect(),
      memory_status: () => this.handleMemoryStatus(),
      show_active_rules: () => this.handleShowActiveRules(),
      list_registered_plugins: () => this.handleListRegisteredPlugins(),
      list_available_tools: () => this.handleListAvailableTools(),
      get_system_prompt: () => this.handleGetSystemPrompt(),
      efficiency_report: () => this.handleEfficiencyReport(),
      show_corrections: () => this.handleShowCorrections(),
    };
    const handler = handlers[name];
    if (!handler) return undefined;
    try {
      return await handler();
    } catch (e) {
      logger.warn("MetacognitionPlugin", `Tool error (${name}): ${e}`);
      return `Tool error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  onMessage(role: Message["role"], content: string): void {
    if (role === "user") {
      // Intentional: only archive turns with tool calls. Pure-inference turns (no tools)
      // are excluded from pattern detection; hedged_no_search won't fire on them.
      if (this.currentTurn.tool_calls.length > 0) {
        this.currentTurn.ended_at = new Date();
        this.turnHistory.push(this.currentTurn);
        if (this.turnHistory.length > TURN_HISTORY_LIMIT) {
          this.turnHistory.shift();
        }
      }
      this.currentTurn = this.newTurn();
      this.blockedTools.clear();
      try {
        const behaviors = this.memoryPlugin.db.getRecentMemories(
          20,
          "behavior",
        );
        this.currentTurn.behavioral_rules_active = behaviors.map((b) =>
          b.text.slice(0, 60),
        );
      } catch {
        // non-critical
      }
      if (USER_UNCERTAINTY_PATTERN.test(content)) {
        this.currentTurn.uncertainty_markers.push("user_query_uncertain");
      }
    } else if (role === "assistant") {
      const hedgePattern =
        /\b(probably|i'm not sure|might be|may be|i guess|not certain)\b/i;
      if (
        hedgePattern.test(content) &&
        !this.currentTurn.uncertainty_markers.includes("hedged_language")
      ) {
        this.currentTurn.uncertainty_markers.push("hedged_language");
      }
      // Run pattern detection after each assistant response (non-blocking)
      this.maybeAutoCorrect().catch(() => {});
    }
  }

  onBeforeToolCall(
    name: string,
    _args: Record<string, unknown>,
  ): { allow: true } | { allow: false; reason: string } {
    if (this.blockedTools.has(name)) {
      return {
        allow: false,
        reason:
          `[Metacognition] '${name}' is blocked this turn. Memory access count ` +
          `(${this.currentTurn.memory_access_count}) exceeded saturation threshold ` +
          `(${this.saturationThreshold}). Synthesize from already-retrieved context ` +
          `rather than issuing another memory search.`,
      };
    }
    return { allow: true };
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

    const recentCorrections = this.correctionHistory.slice(-3);
    const correctionLines =
      recentCorrections.length > 0
        ? recentCorrections.map(
            (c) =>
              `  [${c.trigger}] ${c.rule_saved.slice(0, 80)} (${c.applied_at.toISOString().slice(0, 10)})`,
          )
        : ["  (none)"];

    return [
      `Turn ID: ${t.turn_id}`,
      `Started: ${t.started_at.toISOString()}`,
      `Memory accesses: ${t.memory_access_count}`,
      `Active behavioral rules: ${t.behavioral_rules_active.length > 0 ? t.behavioral_rules_active.join("; ") : "none"}`,
      `Uncertainty markers: ${t.uncertainty_markers.length > 0 ? t.uncertainty_markers.join(", ") : "none"}`,
      "",
      `Tool calls this turn (${t.tool_calls.length}):`,
      ...toolLines,
      "",
      `Recent self-corrections (${this.correctionHistory.length} total):`,
      ...correctionLines,
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
      const behaviors = this.memoryPlugin.db.queryMemories({
        types: ["behavior"],
        limit: 50,
      });
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

    const t = this.currentTurn;
    const callCounts = new Map<string, ToolCallRecord[]>();
    for (const tc of t.tool_calls) {
      const group = callCounts.get(tc.tool) ?? [];
      group.push(tc);
      callCounts.set(tc.tool, group);
    }
    const redundant = [...callCounts.entries()].filter(
      ([, calls]) => calls.length > 1,
    );

    return [
      ...this.buildCurrentTurnSection(t, redundant),
      ...this.buildHistoricalSection(),
      ...this.buildCorrectionSection(),
      ...this.buildSuggestionsSection(t, redundant),
    ].join("\n");
  }

  private buildCurrentTurnSection(
    t: TurnState,
    redundant: [string, ToolCallRecord[]][],
  ): string[] {
    const sections: string[] = ["## Current Turn"];

    if (redundant.length > 0) {
      sections.push(
        "**Redundant tool calls** (same tool invoked multiple times this turn):",
      );
      for (const [tool, calls] of redundant) {
        sections.push(`  ${tool} × ${calls.length}`);
        for (const c of calls) {
          sections.push(`    args: ${c.args_summary}`);
        }
      }
    } else {
      sections.push("No redundant tool calls this turn.");
    }

    if (t.uncertainty_markers.includes("tool_saturation")) {
      sections.push(
        `**Tool saturation**: ${t.memory_access_count} memory accesses exceeded threshold (${this.saturationThreshold}).`,
      );
    }

    if (t.uncertainty_markers.includes("hedged_language")) {
      sections.push(
        "**Hedged language detected** in this turn's response — possible low confidence.",
      );
    }

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

    return sections;
  }

  private buildHistoricalSection(): string[] {
    const historical = this.turnHistory;
    if (historical.length === 0) return [];

    const sections: string[] = [
      `\n## Historical Patterns (last ${historical.length} completed turns)`,
    ];

    const avgMemory =
      historical.reduce((s, turn) => s + turn.memory_access_count, 0) /
      historical.length;
    const avgTools =
      historical.reduce((s, turn) => s + turn.tool_calls.length, 0) /
      historical.length;
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

    const redundantTurns = historical.filter((turn) =>
      this.turnHasRedundancy(turn),
    );
    sections.push(
      `Turns with redundant tool calls: ${redundantTurns.length}/${historical.length}`,
    );

    return sections;
  }

  private buildCorrectionSection(): string[] {
    if (this.correctionHistory.length === 0) return [];

    const sections: string[] = ["\n## Correction Effectiveness"];
    const counts = this.aggregateCorrectionCounts();
    sections.push(
      `Total corrections: ${this.correctionHistory.length} — ` +
        `${counts.effective + counts.effective_after_strengthen} effective, ` +
        `${counts.ineffective} ineffective (CRITICAL, under observation), ` +
        `${counts.failed} failed (cleared for retry), ` +
        `${counts.pending} pending`,
    );
    const ineffective = this.correctionHistory.filter(
      (c) => c.effectiveness === "ineffective",
    );
    if (ineffective.length > 0) {
      sections.push(
        "Ineffective corrections (CRITICAL rule active, second observation window running):",
      );
      for (const c of ineffective) {
        const since = c.strengthened_at
          ? ` since ${c.strengthened_at.toISOString().slice(0, 10)}`
          : "";
        sections.push(`  [${c.trigger}]${since} ${c.rule_saved.slice(0, 80)}`);
      }
    }

    return sections;
  }

  private buildSuggestionsSection(
    t: TurnState,
    redundant: [string, ToolCallRecord[]][],
  ): string[] {
    const sections: string[] = ["\n## Suggestions"];
    const suggestions: string[] = [];

    if (redundant.length > 0) {
      suggestions.push(
        "You called the same tool multiple times this turn. Check whether the first result was sufficient before re-querying.",
      );
    }
    const memoryRatio =
      t.tool_calls.length > 0 ? t.memory_access_count / t.tool_calls.length : 0;
    if (memoryRatio > 0.6 && t.tool_calls.length >= 3) {
      suggestions.push(
        "Over 60% of your tool calls this turn were memory lookups. Consider whether you could have answered from context alone.",
      );
    }
    if (
      t.uncertainty_markers.includes("hedged_language") &&
      t.memory_access_count === 0
    ) {
      suggestions.push(
        "You hedged your response but didn't search memory. A targeted memory search may have resolved the uncertainty.",
      );
    }
    if (
      t.uncertainty_markers.includes("hedged_language") &&
      t.memory_access_count > 3
    ) {
      suggestions.push(
        "You searched memory extensively but still hedged. The relevant memory may not exist yet — consider saving what you learn.",
      );
    }
    if (
      t.uncertainty_markers.includes("user_query_uncertain") &&
      t.memory_access_count === 0
    ) {
      suggestions.push(
        "User expressed uncertainty but you didn't search memory. A targeted retrieval might have produced a more grounded response.",
      );
    }
    const emptySearches = this.turnEmptySearchCount(t);
    if (emptySearches >= 2) {
      suggestions.push(
        `${emptySearches} memory searches returned no results this turn. The information may not exist in memory yet — consider saving what you know rather than re-searching.`,
      );
    }
    if (suggestions.length === 0) {
      suggestions.push("No specific inefficiencies detected this turn.");
    }
    sections.push(...suggestions.map((s) => `- ${s}`));

    return sections;
  }

  private handleListRegisteredPlugins(): string {
    if (!this.agentRef) return "Agent not initialised yet.";
    const plugins = this.agentRef.getRegisteredPlugins();
    if (plugins.length === 0) return "No plugins registered.";
    return [
      `Registered plugins (${plugins.length}):`,
      ...plugins.map(
        (p) =>
          `  ${p.name} — ${p.toolCount} tool${p.toolCount !== 1 ? "s" : ""}`,
      ),
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
    if (!prompt)
      return "No system prompt recorded yet (agent hasn't completed a turn).";
    return `System prompt (${prompt.length} chars):\n\n${prompt}`;
  }

  private handleShowCorrections(): string {
    if (this.correctionHistory.length === 0) {
      return "No self-corrections have been applied yet.";
    }
    const counts = this.aggregateCorrectionCounts();
    return [
      `Self-correction history (${this.correctionHistory.length} total — ` +
        `${counts.effective + counts.effective_after_strengthen} effective, ` +
        `${counts.ineffective} ineffective (CRITICAL), ` +
        `${counts.failed} failed (cleared), ` +
        `${counts.pending} pending):`,
      ...this.correctionHistory.slice(-20).map((c) => {
        const date = c.applied_at.toISOString().slice(0, 16).replace("T", " ");
        const strengthenNote = c.strengthened_at
          ? ` [strengthened ${c.strengthened_at.toISOString().slice(0, 10)}]`
          : "";
        return (
          `[${c.id.slice(0, 8)}] (${date}) trigger=${c.trigger} effectiveness=${c.effectiveness}${strengthenNote}\n` +
          `  rule: ${c.rule_saved.slice(0, 120)}\n` +
          `  behavior_id: ${c.behavior_memory_id.slice(0, 8)}`
        );
      }),
    ].join("\n");
  }

  private categorize(tool: string): ToolCallRecord["category"] {
    if (this.memoryToolNames.has(tool)) return "memory";
    if (this.systemToolNames.has(tool)) return "system";
    return "other";
  }

  private async maybeAutoCorrect(): Promise<void> {
    await this.checkCorrectionEffectiveness();

    const window = this.turnHistory.slice(-PATTERN_WINDOW);
    if (window.length < PATTERN_THRESHOLD) return;

    // Saturation pattern: too many memory searches per turn, repeatedly
    const saturationCount = window.filter((t) =>
      t.uncertainty_markers.includes("tool_saturation"),
    ).length;
    if (saturationCount >= PATTERN_THRESHOLD) {
      await this.saveCorrectiveRule(
        "saturation",
        `Before calling search_memory, hybrid_search, or query_memories, check whether the current turn context already contains the answer. If memory_access_count exceeds ${this.saturationThreshold}, synthesize from what is already retrieved rather than re-searching.`,
        window.length,
      );
    }

    // Redundancy pattern: same tool+args called multiple times in the same turn, repeatedly
    const redundancyCount = window.filter((t) =>
      this.turnHasRedundancy(t),
    ).length;
    if (redundancyCount >= PATTERN_THRESHOLD) {
      await this.saveCorrectiveRule(
        "redundancy",
        "Retrieve information once per turn. Check whether the first tool result was sufficient before calling the same tool again with the same or similar arguments.",
        window.length,
      );
    }

    // Dead-search pattern: multiple empty memory searches per turn, repeatedly
    const deadSearchCount = window.filter(
      (t) => this.turnEmptySearchCount(t) >= 2,
    ).length;
    if (deadSearchCount >= PATTERN_THRESHOLD) {
      await this.saveCorrectiveRule(
        "dead_search",
        "Multiple memory searches returned no results this turn. Before re-searching with similar queries, consider that the information may not be in memory yet. Save what you know, adjust your query significantly, or synthesize from available context rather than issuing further empty searches.",
        window.length,
      );
    }

    // Hedged-no-search pattern: hedging without consulting memory, repeatedly
    const hedgedNoSearchCount = window.filter(
      (t) =>
        t.uncertainty_markers.includes("hedged_language") &&
        t.memory_access_count === 0,
    ).length;
    if (hedgedNoSearchCount >= PATTERN_THRESHOLD) {
      await this.saveCorrectiveRule(
        "hedged_no_search",
        "When uncertain about a fact, search memory before hedging. Expressing uncertainty without first checking memory means potentially available information is going unused.",
        window.length,
      );
    }
  }

  private async saveCorrectiveRule(
    trigger: CorrectionRecord["trigger"],
    rule: string,
    turnsObserved: number,
  ): Promise<void> {
    try {
      // Deduplication: skip if we already saved a correction for this trigger recently
      const recentlySaved = this.correctionHistory
        .slice(-10)
        .some((c) => c.trigger === trigger);
      if (recentlySaved) return;

      // Also skip if an active (non-failed) correction for this trigger already exists in the DB
      const existing = this.memoryPlugin.db.queryMemories({
        types: ["behavior"],
        tags: ["metacognition-correction"],
        contains: trigger,
        limit: 1,
      });
      if (existing.length > 0) {
        const isActive = this.correctionHistory.some(
          (c) =>
            c.behavior_memory_id === existing[0]!.id &&
            c.effectiveness !== "failed",
        );
        if (isActive) return;
        // Otherwise the DB record is stale/orphaned — fall through and allow save
      }

      const behaviorMemoryId = await this.memoryPlugin.db.addMemory(
        rule,
        "behavior",
        ["metacognition-correction", trigger],
      );

      this.correctionHistory.push({
        id: randomUUID(),
        trigger,
        rule_saved: rule,
        behavior_memory_id: behaviorMemoryId,
        applied_at: new Date(),
        turns_observed: turnsObserved,
        effectiveness: "pending",
        post_strengthen_count: 0,
      });
      if (this.correctionHistory.length > CORRECTION_HISTORY_LIMIT) {
        this.correctionHistory.shift();
      }
    } catch {
      // non-critical — corrections are best-effort
    }
  }

  private patternRecurredIn(
    trigger: CorrectionRecord["trigger"],
    turns: TurnState[],
  ): boolean {
    return turns.some((t) => {
      if (trigger === "saturation") {
        return t.uncertainty_markers.includes("tool_saturation");
      }
      if (trigger === "redundancy") {
        return this.turnHasRedundancy(t);
      }
      if (trigger === "dead_search") {
        return this.turnEmptySearchCount(t) >= 2;
      }
      // hedged_no_search
      return (
        t.uncertainty_markers.includes("hedged_language") &&
        t.memory_access_count === 0
      );
    });
  }

  private async checkCorrectionEffectiveness(): Promise<void> {
    const EFFECTIVE_TURNS = 10;
    const STALE_TURNS = EFFECTIVE_TURNS * 2; // 20 clean turns → matches TURN_HISTORY_LIMIT

    // Pre-compute filtered turn slices keyed by timestamp to avoid O(n*m) re-filtering
    const turnsSinceCache = new Map<number, TurnState[]>();
    const turnsSince = (since: Date): TurnState[] => {
      const key = since.getTime();
      if (!turnsSinceCache.has(key)) {
        turnsSinceCache.set(
          key,
          this.turnHistory.filter(
            (t) => (t.ended_at ?? t.started_at) > since,
          ),
        );
      }
      return turnsSinceCache.get(key)!;
    };

    // Iterate over a snapshot to avoid mutation issues within the loop
    for (const correction of [...this.correctionHistory]) {
      // === Pending: first resolution check ===
      if (correction.effectiveness === "pending") {
        const turns = turnsSince(correction.applied_at);
        if (turns.length === 0) continue;

        const recurred = this.patternRecurredIn(correction.trigger, turns);

        if (recurred) {
          correction.effectiveness = "ineffective";
          // Only strengthen once — ceiling guard in strengthenCorrectiveRule handles re-entry
          if (correction.post_strengthen_count === 0) {
            await this.strengthenCorrectiveRule(correction);
          }
        } else if (turns.length >= EFFECTIVE_TURNS) {
          correction.effectiveness = "effective";
        }
      }

      // === Effective / effective_after_strengthen: prune when stale ===
      else if (
        correction.effectiveness === "effective" ||
        correction.effectiveness === "effective_after_strengthen"
      ) {
        if (turnsSince(correction.applied_at).length >= STALE_TURNS) {
          await this.maybePruneCorrection(correction);
        }
      }

      // === Ineffective: second observation window after CRITICAL strengthening ===
      else if (correction.effectiveness === "ineffective") {
        if (!correction.strengthened_at) continue;

        const turns = turnsSince(correction.strengthened_at);
        if (turns.length === 0) continue;

        const recurredAfterStrengthen = this.patternRecurredIn(
          correction.trigger,
          turns,
        );

        if (
          !recurredAfterStrengthen &&
          turns.length >= EFFECTIVE_TURNS
        ) {
          // CRITICAL rule worked — treat as effective and let the stale check prune it
          correction.effectiveness = "effective_after_strengthen";
        } else if (
          recurredAfterStrengthen &&
          correction.post_strengthen_count >= 1
        ) {
          // Truly stuck — full cleanup to unlock retry for this trigger
          correction.effectiveness = "failed";
          try {
            await this.memoryPlugin.executeTool!("delete_memory", {
              id: correction.behavior_memory_id,
            });
          } catch {
            // non-critical
          }
          this.correctionHistory = this.correctionHistory.filter(
            (c) => c.id !== correction.id,
          );
        }
      }
    }
  }

  private async strengthenCorrectiveRule(
    correction: CorrectionRecord,
  ): Promise<void> {
    // Ceiling guard — do not stack CRITICAL prefixes
    // Use post_strengthen_count as the canonical guard; startsWith check is a
    // belt-and-suspenders fallback for records reconstructed from DB text.
    if (correction.post_strengthen_count > 0) return;
    if (correction.rule_saved.startsWith("CRITICAL")) return;
    try {
      const strengthened = `CRITICAL (pattern persisted after correction): ${correction.rule_saved}`;
      // Delete old memory and recreate with the ineffective tag so status survives restarts.
      // Capture the old ID before deletion so we can restore if addMemory fails.
      const oldId = correction.behavior_memory_id;
      await this.memoryPlugin.executeTool!("delete_memory", { id: oldId });
      let newId: string;
      try {
        newId = await this.memoryPlugin.db.addMemory(
          strengthened,
          "behavior",
          [
            "metacognition-correction",
            correction.trigger,
            "metacognition-correction:ineffective",
          ],
        );
      } catch (innerErr) {
        // addMemory failed — the old record is already gone. Log and leave the
        // in-memory correction record intact so it stays observable, but do not
        // update behavior_memory_id (it is now stale/dangling).
        logger.warn(
          "MetacognitionPlugin",
          `strengthenCorrectiveRule: delete succeeded but addMemory failed for trigger=${correction.trigger}: ${innerErr}`,
        );
        return;
      }
      correction.behavior_memory_id = newId;
      correction.rule_saved = strengthened;
      correction.strengthened_at = new Date();
      correction.post_strengthen_count += 1;
    } catch {
      // non-critical
    }
  }

  private async maybePruneCorrection(
    correction: CorrectionRecord,
  ): Promise<void> {
    try {
      await this.memoryPlugin.executeTool!("delete_memory", {
        id: correction.behavior_memory_id,
      });
      this.correctionHistory = this.correctionHistory.filter(
        (c) => c.id !== correction.id,
      );
    } catch {
      // non-critical
    }
  }

  private aggregateCorrectionCounts(): {
    pending: number;
    effective: number;
    ineffective: number;
    effective_after_strengthen: number;
    failed: number;
  } {
    const counts = {
      pending: 0,
      effective: 0,
      ineffective: 0,
      effective_after_strengthen: 0,
      failed: 0,
    };
    for (const c of this.correctionHistory) counts[c.effectiveness]++;
    return counts;
  }

  private turnEmptySearchCount(turn: TurnState): number {
    return turn.tool_calls.filter(
      (tc) =>
        tc.category === "memory" &&
        typeof tc.result_meta?.result_count === "number" &&
        tc.result_meta.result_count === 0,
    ).length;
  }

  private turnHasRedundancy(turn: TurnState): boolean {
    const seen = new Set<string>();
    for (const tc of turn.tool_calls) {
      const key = `${tc.tool}:${tc.args_summary}`;
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  }
}
