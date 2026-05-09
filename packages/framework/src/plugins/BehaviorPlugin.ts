/**
 * BehaviorPlugin — owns behavior injection, self-shaping tools, and conflict detection.
 *
 * Extracted from CortexMemoryPlugin so that self-shaping is an opt-in capability
 * rather than baked into the memory system. CortexMemoryPlugin remains the backing
 * store for behavior memories; BehaviorPlugin reads and writes through its public API.
 *
 * Behavior injection uses a weight spectrum (0.0–1.0) instead of the old binary
 * core/contextual split:
 *   - weight >= 0.9 OR tagged "core" → always injected, bypasses embedding search
 *   - weight < 0.9 → semantic retrieval; effective threshold = (1 - weight) * 0.5
 *     clamped to [0.15, 0.5] so high-weight rules fire broadly, low-weight rules
 *     only when contextually close.
 *
 * Conflict detection runs on every save_behavior call. If the new behavior has
 * similarity 0.5–0.85 with an existing one (similar enough to conflict, not similar
 * enough to dedup), the tool result includes a warning and a
 * `behavior:conflict_detected` event is emitted for the web UI.
 *
 * Tools provided:
 *   save_behavior         — save a new behavioral rule with optional weight
 *   synthesize_behaviors  — resolve a conflict via structured LLM synthesis
 *   activate_profile      — force-load all behaviors tagged with a profile name
 *   force_behavior        — pin a specific behavior ID for the session
 *   suppress_behavior     — exclude a specific behavior ID for the session
 */
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { CortexMemoryPlugin } from "./CortexMemoryPlugin.ts";
import { logger } from "../logger.ts";

const MAX_CONTENT_LENGTH = 10_000;

export interface ConflictRecord {
  newId: string;
  newText: string;
  conflictId: string;
  conflictText: string;
  score: number;
  timestamp: number;
}

export class BehaviorPlugin implements AgentPlugin {
  name = "Behavior";

  private memoryPlugin: CortexMemoryPlugin;
  private llm: LLMProvider;
  private agent: BaseAgent | null = null;

  /** Session-level forced behavior IDs — always injected regardless of weight/score. */
  private forcedBehaviorIds: Set<string> = new Set();
  /** Session-level suppressed behavior IDs — never injected. */
  private suppressedBehaviorIds: Set<string> = new Set();
  /** Profile behaviors loaded via activate_profile — injected until session ends. */
  private profileBehaviors: Array<{ id: string; text: string; weight: number }> = [];

  /** Pending conflict queue — accessed externally only via getConflicts() and dismissConflict(). */
  private pendingConflicts: Map<string, ConflictRecord> = new Map();

  constructor(memoryPlugin: CortexMemoryPlugin, llm: LLMProvider) {
    this.memoryPlugin = memoryPlugin;
    this.llm = llm;
  }

  onInit(agent: BaseAgent): void {
    this.agent = agent;
  }

  // ── System prompt injection ───────────────────────────────────────────────

  async getSystemPromptFragment(context?: string): Promise<string> {
    const parts: string[] = [
      "## Behavior System",
      "You have a self-shaping behavior system. Behaviors are persistent rules that actively shape how you respond.",
      "Use `save_behavior` to record a new behavioral rule.",
      "  - `weight` (0.0–1.0): how strongly this rule applies. 1.0 = always active (personality-level). 0.5 = general preference. 0.1 = situational only. Default: 0.5.",
      "  - `core: true` is shorthand for weight 1.0 — always injected into every turn.",
      "  - Tagging behaviors with profile names (e.g. `tags: [\"technical\"]`) lets you `activate_profile(\"technical\")` to load all matching behaviors for the session.",
      "Use `synthesize_behaviors` to resolve a flagged conflict between two behaviors.",
      "Use `activate_profile` to force-load all behaviors tagged with a given profile name.",
      "Use `force_behavior` to pin a specific behavior ID as active for this session.",
      "Use `suppress_behavior` to exclude a specific behavior ID from this session.",
      "When a conflict is detected after saving a behavior, call `synthesize_behaviors` to resolve it — or dismiss by ignoring the warning.",
    ];

    try {
      const coreBehaviors: Array<{ id: string; text: string; weight: number }> = [];
      const contextualBehaviors: Array<{ id: string; text: string; score: number; weight: number }> = [];

      // ── Sticky behaviors: weight >= 0.9 or tagged "core" ─────────────────
      const allBehaviors = this.memoryPlugin.queryMemoriesRaw({ types: ["behavior"], limit: 200 });
      const stickySet = new Set<string>();

      for (const b of allBehaviors) {
        if (this.suppressedBehaviorIds.has(b.id)) continue;
        const isSticky = (b.weight ?? 1.0) >= 0.9 || b.tags.includes("core");
        if (isSticky) {
          coreBehaviors.push({ id: b.id, text: b.text, weight: b.weight ?? 1.0 });
          stickySet.add(b.id);
        }
      }

      // ── Forced session behaviors ──────────────────────────────────────────
      for (const id of this.forcedBehaviorIds) {
        if (stickySet.has(id) || this.suppressedBehaviorIds.has(id)) continue;
        const b = await this.memoryPlugin.getMemoryById(id);
        if (b && b.status === "active") {
          coreBehaviors.push({ id: b.id, text: b.text, weight: b.weight });
          stickySet.add(id);
        }
      }

      // ── Profile behaviors ─────────────────────────────────────────────────
      for (const pb of this.profileBehaviors) {
        if (stickySet.has(pb.id) || this.suppressedBehaviorIds.has(pb.id)) continue;
        coreBehaviors.push(pb);
        stickySet.add(pb.id);
      }

      // ── Contextual behaviors: semantic search, weight-adjusted threshold ──
      if (context?.trim()) {
        const embedding = await this.memoryPlugin.getOrComputeEmbedding(context);
        // Search at minimum possible threshold — filter each result by its own weight-adjusted threshold
        const candidates = this.memoryPlugin.searchBehaviorsWithEmbedding(embedding, 30, 0.15);
        for (const c of candidates) {
          if (stickySet.has(c.id) || this.suppressedBehaviorIds.has(c.id)) continue;
          const weight = c.weight ?? 1.0;
          const effectiveThreshold = Math.max(0.15, Math.min(0.5, (1.0 - weight) * 0.5));
          if (c.score >= effectiveThreshold) {
            contextualBehaviors.push({ id: c.id, text: c.text, score: c.score, weight });
          }
        }
        // Sort by weight desc, then score desc; cap at 15
        contextualBehaviors.sort((a, b) => (b.weight - a.weight) || (b.score - a.score));
        contextualBehaviors.splice(15);
      } else {
        // No context yet — fall back to most recent non-sticky behaviors
        const recent = this.memoryPlugin.queryMemoriesRaw({ types: ["behavior"], limit: 30 });
        for (const r of recent) {
          if (stickySet.has(r.id) || this.suppressedBehaviorIds.has(r.id)) continue;
          if ((r.weight ?? 1.0) < 0.9) {
            contextualBehaviors.push({ id: r.id, text: r.text, score: 1.0, weight: r.weight ?? 1.0 });
            if (contextualBehaviors.length >= 15) break;
          }
        }
      }

      logger.debug(
        this.name,
        `getSystemPromptFragment: ${coreBehaviors.length} sticky + ${contextualBehaviors.length} contextual behaviors`,
      );

      if (coreBehaviors.length > 0) {
        parts.push("\n## Always Active Behaviors");
        for (const b of coreBehaviors) {
          parts.push(`- ${b.text.trim()}`);
        }
      }
      if (contextualBehaviors.length > 0) {
        parts.push("\n## Contextually Active Behaviors");
        for (const b of contextualBehaviors) {
          parts.push(`- ${b.text.trim()}`);
        }
      }

      // Emit behaviors_loaded for web UI
      if (this.agent) {
        this.agent.emit("behaviors_loaded", coreBehaviors, contextualBehaviors);
      }
    } catch (e) {
      logger.error(this.name, "Failed to load behavior memories for system prompt:", e);
    }

    return parts.join("\n");
  }

  // ── Tools ─────────────────────────────────────────────────────────────────

  getTools(): ToolDefinition[] {
    return [
      {
        name: "save_behavior",
        description:
          "Save a persistent behavioral rule that shapes how you respond. `weight` (0.0–1.0) controls when it activates: 1.0 = always active (personality-level), 0.5 = general preference (default), 0.1 = fires only when contextually close. `core: true` is shorthand for weight 1.0. Tag with profile names (e.g. `tags: [\"technical\"]`) to group related behaviors. After saving, a conflict check runs automatically — if a conflict is detected you will be prompted to call `synthesize_behaviors`.",
        parameters: {
          type: "object",
          properties: {
            rule: { type: "string", description: "The behavioral rule to persist" },
            weight: {
              type: "number",
              description: "Injection priority from 0.0 (situational) to 1.0 (always active). Default: 0.5.",
            },
            core: {
              type: "boolean",
              description: "Shorthand for weight 1.0 — always injected. Takes precedence over `weight` if both provided.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags, e.g. profile names like 'technical', 'creative'.",
            },
          },
          required: ["rule"],
        },
      },
      {
        name: "synthesize_behaviors",
        description:
          "Resolve a conflict between two behaviors by synthesizing them into a single unified rule. Both originals are superseded. Call this after a conflict is flagged by save_behavior.",
        parameters: {
          type: "object",
          properties: {
            id_a: { type: "string", description: "ID of the first behavior" },
            id_b: { type: "string", description: "ID of the second behavior" },
          },
          required: ["id_a", "id_b"],
        },
      },
      {
        name: "activate_profile",
        description:
          "Force-load all behaviors tagged with a given profile name for the rest of this session, regardless of their weight or semantic relevance. Use to switch into a mode like 'technical' or 'creative'.",
        parameters: {
          type: "object",
          properties: {
            profile: { type: "string", description: "The tag/profile name to activate" },
          },
          required: ["profile"],
        },
      },
      {
        name: "force_behavior",
        description: "Pin a specific behavior by ID as always-active for this session.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Behavior memory ID to force-activate" },
          },
          required: ["id"],
        },
      },
      {
        name: "suppress_behavior",
        description: "Exclude a specific behavior by ID from firing for the rest of this session.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Behavior memory ID to suppress" },
          },
          required: ["id"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<string | undefined> {
    try {
      if (name === "save_behavior") return await this.handleSaveBehavior(args);
      if (name === "synthesize_behaviors") return await this.handleSynthesizeBehaviors(args);
      if (name === "activate_profile") return this.handleActivateProfile(args);
      if (name === "force_behavior") return this.handleForceBehavior(args);
      if (name === "suppress_behavior") return this.handleSuppressBehavior(args);
    } catch (e) {
      logger.error(this.name, `Tool error (${name}):`, e);
      return `Tool error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // ── Tool handlers ─────────────────────────────────────────────────────────

  private async handleSaveBehavior(args: any): Promise<string> {
    const rule = String(args.rule ?? "").trim();
    if (!rule) return "Behavior rule cannot be empty.";
    if (rule.length > MAX_CONTENT_LENGTH) {
      return `Behavior rule too long (${rule.length} chars). Maximum is ${MAX_CONTENT_LENGTH} characters.`;
    }

    const isCore = args.core === true;
    const rawWeight = typeof args.weight === "number" ? args.weight : 0.5;
    const weight = isCore ? 1.0 : Math.max(0, Math.min(1, rawWeight));
    const tags: string[] = Array.isArray(args.tags) ? args.tags.map(String) : [];
    if (isCore && !tags.includes("core")) tags.push("core");

    logger.info(this.name, `save_behavior [weight=${weight.toFixed(2)}]: "${rule.slice(0, 100)}"`);

    const id = await this.memoryPlugin.writeMemory(rule, "behavior", tags, "BehaviorPlugin", weight);
    if (id === null) {
      return "Behavior skipped — a near-identical rule already exists.";
    }

    // ── Conflict detection: similarity 0.5–0.85 ───────────────────────────
    const conflictWarnings: string[] = [];
    try {
      const embedding = await this.memoryPlugin.getOrComputeEmbedding(rule);
      const candidates = this.memoryPlugin.searchBehaviorsWithEmbedding(embedding, 5, 0.5);
      for (const c of candidates) {
        if (c.id === id) continue; // skip the just-saved behavior
        if (c.score >= 0.85) continue; // handled by dedup (0.92 threshold skips; 0.85–0.92 is a gray zone)
        // 0.5 <= score < 0.85: potential conflict
        const conflict: ConflictRecord = {
          newId: id,
          newText: rule,
          conflictId: c.id,
          conflictText: c.text,
          score: c.score,
          timestamp: Date.now(),
        };
        const conflictKey = [id, c.id].sort().join("::");
        this.pendingConflicts.set(conflictKey, conflict);
        conflictWarnings.push(
          `⚠ Possible conflict with [${c.id}] (similarity ${(c.score * 100).toFixed(0)}%): "${c.text.slice(0, 80)}${c.text.length > 80 ? "…" : ""}" — call synthesize_behaviors("${id}", "${c.id}") to resolve.`,
        );
        if (this.agent) {
          this.agent.emit("behavior:conflict_detected", id, rule, c.id, c.text, c.score);
        }
      }
    } catch (e) {
      logger.warn(this.name, "Conflict detection failed (non-critical):", e);
    }

    const base = `Behavior saved (id: ${id}, weight: ${weight.toFixed(2)}).`;
    if (conflictWarnings.length > 0) {
      return [base, ...conflictWarnings].join("\n");
    }
    return base;
  }

  /** Public entry point for web server REST synthesize endpoint. */
  public async synthesize(idA: string, idB: string): Promise<string> {
    return this.handleSynthesizeBehaviors({ id_a: idA, id_b: idB });
  }

  private async handleSynthesizeBehaviors(args: any): Promise<string> {
    const idA = String(args.id_a ?? "").trim();
    const idB = String(args.id_b ?? "").trim();
    if (!idA || !idB) return "Both id_a and id_b are required.";

    const [memA, memB] = await Promise.all([
      this.memoryPlugin.getMemoryById(idA),
      this.memoryPlugin.getMemoryById(idB),
    ]);
    if (!memA) return `Behavior [${idA}] not found.`;
    if (!memB) return `Behavior [${idB}] not found.`;

    logger.info(this.name, `synthesize_behaviors: "${memA.text.slice(0, 60)}" ↔ "${memB.text.slice(0, 60)}"`);

    const synthesisPrompt = [
      "You are resolving a conflict between two behavioral rules for an AI assistant.",
      "Produce a single unified rule that honors the intent of both, resolving any tension between them.",
      "Return only the unified rule text — no explanation, no preamble.",
      "",
      `Rule A: ${memA.text}`,
      `Rule B: ${memB.text}`,
    ].join("\n");

    let synthesized: string;
    try {
      const result = await this.llm.chat(
        [{ role: "user", content: synthesisPrompt }],
        "You are a concise behavioral rule synthesizer. Output only the unified rule.",
      );
      synthesized = result.nonReasoningContent.trim();
      if (!synthesized) throw new Error("Empty synthesis result");
    } catch (e) {
      return `Synthesis failed: ${e instanceof Error ? e.message : String(e)}`;
    }

    // Save synthesized behavior with the higher weight of the two originals
    const newWeight = Math.max(memA.weight ?? 1.0, memB.weight ?? 1.0);
    const newId = await this.memoryPlugin.writeMemory(synthesized, "behavior", [], "BehaviorPlugin:synthesis", newWeight);
    if (!newId) {
      return `Synthesis complete but result was a near-duplicate of an existing behavior: "${synthesized}"`;
    }

    // Supersede both originals
    await this.memoryPlugin.supersedeBehavior(idA, newId);
    await this.memoryPlugin.supersedeBehavior(idB, newId);

    // Remove from pending conflict queue
    for (const key of this.pendingConflicts.keys()) {
      if (key.includes(idA) || key.includes(idB)) {
        this.pendingConflicts.delete(key);
      }
    }

    return [
      `Synthesis complete. New behavior saved (id: ${newId}, weight: ${newWeight.toFixed(2)}):`,
      `"${synthesized}"`,
      `Both [${idA.slice(0, 8)}] and [${idB.slice(0, 8)}] have been superseded.`,
    ].join("\n");
  }

  private handleActivateProfile(args: any): string {
    const profile = String(args.profile ?? "").trim();
    if (!profile) return "Profile name cannot be empty.";

    const matching = this.memoryPlugin.queryMemoriesRaw({ types: ["behavior"], tags: [profile] });
    if (matching.length === 0) {
      return `No behaviors found with tag "${profile}".`;
    }

    let added = 0;
    for (const b of matching) {
      const alreadyLoaded = this.profileBehaviors.some(pb => pb.id === b.id);
      if (!alreadyLoaded) {
        this.profileBehaviors.push({ id: b.id, text: b.text, weight: b.weight ?? 1.0 });
        added++;
      }
    }

    logger.info(this.name, `activate_profile "${profile}": loaded ${added} behavior(s)`);
    return `Profile "${profile}" activated — ${added} behavior(s) added to always-active set (${matching.length} total in profile).`;
  }

  private handleForceBehavior(args: any): string {
    const id = String(args.id ?? "").trim();
    if (!id) return "Behavior ID cannot be empty.";
    this.forcedBehaviorIds.add(id);
    logger.info(this.name, `force_behavior: pinned [${id.slice(0, 8)}]`);
    return `Behavior [${id.slice(0, 8)}] pinned as always-active for this session.`;
  }

  private handleSuppressBehavior(args: any): string {
    const id = String(args.id ?? "").trim();
    if (!id) return "Behavior ID cannot be empty.";
    this.suppressedBehaviorIds.add(id);
    this.forcedBehaviorIds.delete(id); // remove from forced if it was there
    logger.info(this.name, `suppress_behavior: suppressed [${id.slice(0, 8)}]`);
    return `Behavior [${id.slice(0, 8)}] suppressed for this session.`;
  }

  // ── Public API for web server ─────────────────────────────────────────────

  /** Return pending conflicts as an array for the REST endpoint. */
  public getConflicts(): ConflictRecord[] {
    return Array.from(this.pendingConflicts.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Dismiss a conflict from the queue without synthesizing. */
  public dismissConflict(key: string): boolean {
    return this.pendingConflicts.delete(key);
  }
}
