import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { MemoryWriteRequest } from "../core/types.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import {
  CortexMemoryDatabase,
  type MemoryFilter,
  type SearchMeta,
} from "./CortexMemoryDatabase.ts";
import { logger } from "../logger.ts";

/** Maximum character length enforced on user-supplied memory content fields. */
const MAX_CONTENT_LENGTH = 10_000;

interface RetrievalTrace {
  timestamp: number;
  query_length: number;
  factual: Array<{ id: string; score: number }>;
  procedure: Array<{ id: string; score: number }>;
  recent_thoughts: Array<{ id: string }>;
}

export interface CortexMemoryPluginOptions {
  factualContextBudgetChars?: number;
  procedureContextBudgetChars?: number;
}

export class CortexMemoryPlugin implements AgentPlugin {
  name = "CortexMemory";
  private db: CortexMemoryDatabase;

  /**
   * Events captured from the current turn's getContext() call.
   * Read by onMessage() to build the conflict-resolution query.
   * These two hooks are intentionally coupled: getContext() must be called
   * before onMessage() each turn so this field is current.
   */
  private currentEvents: string[] = [];
  private savedThisTurn: Set<string> = new Set();
  /** Text of memories saved this turn, keyed by ID. Used by onMessage() for per-pair conflict classification. */
  private savedThisTurnTexts: Map<string, string> = new Map();

  /** Cached core behavior memories (tagged "core"), invalidated when a core behavior is saved or deleted. */
  private coreBehaviorCache: Array<{ id: string; text: string }> | null = null;

  /** Side-channel metadata from the most recent memory search (keyed by tool name). */
  public searchMetaBuffer: Map<string, SearchMeta> = new Map();

  /** Retrieval trace from the most recent automatic getContext() call. */
  public lastRetrievalTrace: RetrievalTrace | null = null;

  private readonly MAX_MEMORY_TEXT_LENGTH = 300;
  private readonly factualBudget: number;
  private readonly procedureBudget: number;

  /**
   * Per-turn embedding cache. Both getSystemPromptFragment() and getContext() embed
   * the same user input string to do their respective semantic searches. Without this
   * cache, each turn would make two embedding round-trips to the LLM provider for
   * identical text. The cache is keyed by query string and overwritten whenever the
   * query changes (i.e. on every new turn).
   */
  private embeddingCache: { query: string; embedding: Float32Array } | null = null;

  constructor(llmProvider: LLMProvider, name: string, dbPath?: string, options?: CortexMemoryPluginOptions) {
    this.db = new CortexMemoryDatabase(llmProvider, name, dbPath);
    this.factualBudget = options?.factualContextBudgetChars ?? 1200;
    this.procedureBudget = options?.procedureContextBudgetChars ?? 600;
  }

  /**
   * Subscribe to memory:write_request events from any plugin on the same agent.
   * This makes CortexMemoryPlugin the memory broker: all programmatic writes from
   * ThoughtPlugin, MemoryPlugin, and any future producers flow through writeMemory()
   * without those plugins holding a direct reference to this plugin.
   */
  onInit(agent: BaseAgent): void {
    agent.on("memory:write_request", (request: MemoryWriteRequest) => {
      this.writeMemory(request.text, request.type, request.tags ?? [], request.source)
        .catch(e => logger.error(this.name, "Failed to handle memory:write_request:", e));
    });
  }

  // ─── Programmatic write/read interface for internal plugins ──────────────────
  //
  // These methods are the ONLY sanctioned way for other plugins to interact with
  // the memory store. Direct access to `db` is intentionally private so that all
  // writes flow through this layer and maintain the plugin's internal invariants:
  // savedThisTurn tracking, near-dup deduplication, cache invalidation, and
  // MAX_CONTENT_LENGTH enforcement.

  /**
   * Write a memory through the full tracking layer.
   *
   * - Enforces MAX_CONTENT_LENGTH (truncates with a warning).
   * - For `behavior` type: performs a pre-write semantic dedup check at 0.92 and
   *   returns null (skipping the write) if a near-duplicate already exists.
   * - For `factual` / `procedure` types: runs post-write near-dup superseding at 0.9.
   * - Updates `savedThisTurn` so that `onMessage` conflict resolution fires correctly.
   * - Invalidates `coreBehaviorCache` when a core-tagged behavior is saved.
   *
   * @returns The new memory ID, or null if the write was skipped due to dedup.
   */
  public async writeMemory(
    text: string,
    type: "factual" | "thought" | "behavior" | "procedure",
    tags: string[] = [],
    source?: string,
  ): Promise<string | null> {
    if (text.length > MAX_CONTENT_LENGTH) {
      logger.warn(this.name, `writeMemory: content too long (${text.length} chars), truncating to ${MAX_CONTENT_LENGTH}`);
      text = text.slice(0, MAX_CONTENT_LENGTH);
    }

    // Behavior: pre-write semantic dedup — skip if near-duplicate already exists
    if (type === "behavior") {
      const similar = await this.db.search(text, 1, 0.92, "behavior");
      if (similar.length > 0) {
        logger.debug(
          this.name,
          `writeMemory: behavior skipped — near-duplicate (score=${similar[0]!.score.toFixed(3)}): "${text.slice(0, 80)}"`,
        );
        return null;
      }
    }

    const id = await this.db.addMemory(text, type, tags, source);
    this.savedThisTurn.add(id);
    this.savedThisTurnTexts.set(id, text);

    // Invalidate core behavior cache when a core-tagged behavior is saved
    if (type === "behavior" && tags.includes("core")) {
      this.coreBehaviorCache = null;
    }

    // Factual/procedure: post-write near-dup superseding at 0.9
    if (type === "factual" || type === "procedure") {
      const nearDups = await this.db.search(text, 5, 0.9, type);
      for (const s of nearDups) {
        if (s.id !== id) await this.db.updateMemoryStatus(s.id, "superseded");
      }
    }

    logger.debug(this.name, `writeMemory: stored type=${type} id=${id.slice(0, 8)} source=${source ?? "unknown"}`);
    return id;
  }

  /**
   * Read the N most recent active memories of a given type.
   * Used by ThoughtPlugin's `get_recent_thoughts` tool.
   */
  public getRecentMemories(limit: number, type?: string): Array<{ id: string; text: string; timestamp: number }> {
    return this.db.getRecentMemories(limit, type);
  }

  /**
   * Raw memory query by metadata filter. Returns the full row array.
   * Used by MetacognitionPlugin to reconstruct correction history on init.
   */
  public queryMemoriesRaw(filter: MemoryFilter): Array<{ id: string; text: string; timestamp: number; type: string; tags: string[] }> {
    return this.db.queryMemories(filter);
  }

  /**
   * Fetch a single memory by ID. Used in tests and by plugins that need to
   * inspect a specific row after writing.
   */
  public getMemoryById(id: string) {
    return this.db.getMemoryById(id);
  }

  /**
   * Raw database write — bypasses savedThisTurn tracking, dedup, and MAX_CONTENT_LENGTH.
   * Appropriate for: test setup (pre-populating state without triggering conflict resolution),
   * and callers that manage their own deduplication before calling (e.g., MetacognitionPlugin
   * which checks for existing corrections before writing).
   * Most callers should use writeMemory() instead.
   */
  public addMemoryRaw(
    text: string,
    type: string = "factual",
    tags: string[] = [],
    source?: string,
    confidence?: number,
    supersededById?: string,
    reconstructedFromId?: string,
  ): Promise<string> {
    return this.db.addMemory(text, type, tags, source, confidence, supersededById, reconstructedFromId);
  }

  /**
   * Create a bidirectional link between two memories.
   * Used in tests to set up linked memory state for get_linked_memories tests.
   */
  public linkMemories(idA: string, idB: string, linkType?: string): Promise<void> {
    return this.db.linkMemories(idA, idB, linkType);
  }

  /**
   * Aggregate memory counts grouped by type, tag, or date.
   * Used by MetacognitionPlugin's memory_status tool.
   */
  public aggregateMemories(groupBy: "type" | "tag" | "date", filter?: MemoryFilter): Array<{ group: string; count: number }> {
    return this.db.aggregateMemories(groupBy, filter);
  }

  /**
   * Delete a memory by ID with proper cache invalidation.
   * Used by MetacognitionPlugin to prune stale correction records.
   */
  public async deleteMemoryById(id: string): Promise<void> {
    const existing = await this.db.getMemoryById(id);
    if (!existing) return;
    if (existing.type === "behavior" && (existing.tags ?? []).includes("core")) {
      this.coreBehaviorCache = null;
    }
    await this.db.deleteMemory(id);
  }

  // ─────────────────────────────────────────────────────────────────────────────

  async getSystemPromptFragment(context?: string): Promise<string> {
    const parts = [
      "## Memory System",
      "You have a long-term memory system with four types of memories:",
      "- **factual**: specific details from conversations, decisions, established facts.",
      "- **thought**: your internal reasoning and reflections (written by your thought system).",
      "- **behavior**: learned preferences and behavioral rules (injected as active instructions).",
      "- **procedure**: step-by-step instructions for accomplishing a task you have previously solved.",
      "Relevant factual memories and procedures are automatically surfaced in your context at the start of each turn — check there before calling search_memory.",
      "Use `save_memory` to preserve important facts or decisions.",
      "Use `save_behavior` to record a persistent behavioral rule you want to follow on every future turn. Pass `core: true` for universal rules that should always be active (e.g. formatting, tone). Omit or pass `core: false` for context-specific rules that will be surfaced when relevant.",
      "Use `save_procedure` after successfully completing a non-trivial task to record the steps taken.",
      "Use `edit_memory` to update the text of an existing memory by its ID.",
      "Use `delete_memory` to remove a memory. Single form: `{ id }`. Batch form: `{ ids: [id1, id2, ...] }` — deletes multiple memories in one call and triggers one cache invalidation regardless of how many IDs are provided.",
      "Use `get_linked_memories` to follow chains of related ideas.",
      "Use `get_memory_lineage` to trace how a memory has evolved over time — what it replaced, and what has since replaced it.",
      "When saving a memory that updates a prior one, use `supersedes` to preserve the lineage rather than deleting the old memory.",
      "Use `query_memories` to filter memories by type, tags, date range, or full-text content.",
      "Use `hybrid_search` to combine semantic similarity search with metadata filters.",
      "Use `aggregate_memories` to understand the shape and distribution of your memories.",
      "Use `get_memory_timeline` to retrieve memories in chronological order.",
    ];

    try {
      // Core behaviors: always active, cached until a core behavior is saved or deleted
      if (this.coreBehaviorCache === null) {
        const rows = this.db.queryMemories({
          types: ["behavior"],
          tags: ["core"],
          limit: 50,
        });
        this.coreBehaviorCache = rows.map(r => ({ id: r.id, text: r.text }));
      }

      // Contextual behaviors: semantically matched to the current input
      let contextualBehaviors: Array<{ id: string; text: string }> = [];
      const coreIds = new Set(this.coreBehaviorCache.map(b => b.id));

      if (context?.trim()) {
        // Populate the cache if this is the first call this turn or the query changed.
        // getContext() runs next (BaseAgent calls fragment before context within each plugin)
        // and will reuse this embedding rather than issuing a second LLM request.
        if (!this.embeddingCache || this.embeddingCache.query !== context) {
          this.embeddingCache = { query: context, embedding: await this.db.getEmbedding(context) };
        }
        const results = this.db.searchWithEmbedding(this.embeddingCache.embedding, 15, 0.35, "behavior");
        contextualBehaviors = results.filter(r => !coreIds.has(r.id));
        logger.debug(
          this.name,
          `getSystemPromptFragment: ${this.coreBehaviorCache.length} core + ${contextualBehaviors.length} contextual behaviors`,
        );
      } else {
        // No context yet (e.g. init) — fall back to recency
        const recent = this.db.getRecentMemories(20, "behavior");
        contextualBehaviors = recent.filter(r => !coreIds.has(r.id)).slice(0, 15);
      }

      if (this.coreBehaviorCache.length > 0) {
        parts.push("\n## Core Behaviors");
        for (const b of this.coreBehaviorCache) {
          parts.push(`- ${b.text.trim()}`);
        }
      }
      if (contextualBehaviors.length > 0) {
        parts.push("\n## Contextually Active Behaviors");
        for (const b of contextualBehaviors) {
          parts.push(`- ${b.text.trim()}`);
        }
      }
    } catch (e) {
      logger.error(this.name, "Failed to load behavior memories for system prompt:", e);
    }

    return parts.join("\n");
  }

  async getContext(currentEvents?: string[]): Promise<string> {
    try {
      this.currentEvents = currentEvents ?? [];
      this.savedThisTurn.clear();
      this.savedThisTurnTexts.clear();
      const query = currentEvents?.join(" ") ?? "";
      if (!query.trim()) return "";

      logger.debug(this.name, `getContext() searching: "${query.slice(0, 80)}…"`);
      // Reuse the embedding computed by getSystemPromptFragment() if the query matches.
      // When both hooks are called in the same turn (the normal path), this skips the
      // second LLM embedding call entirely.
      if (!this.embeddingCache || this.embeddingCache.query !== query) {
        this.embeddingCache = { query, embedding: await this.db.getEmbedding(query) };
      }
      const embedding = this.embeddingCache.embedding;

      // Retrieve candidates for MMR selection (up to 8 factual) and top-1 procedure
      const factualCandidates = this.db.searchWithEmbedding(embedding, 8, 0.5, ["factual"], true);
      const procedureResults = this.db.searchWithEmbedding(embedding, 1, 0.65, ["procedure"]);

      // MMR selection: diverse factual memories within budget
      const factualResults = this.selectWithMMR(factualCandidates, this.factualBudget, 5, 0.6);

      // Recent thoughts — always 2 most recent regardless of query
      const recentThoughts = this.db.getRecentMemories(2, "thought");

      logger.debug(
        this.name,
        `getContext() selected ${factualResults.length} factual (MMR), ${procedureResults.length} procedures`,
      );

      // Populate retrieval trace
      this.lastRetrievalTrace = {
        timestamp: Date.now(),
        query_length: query.length,
        factual: factualResults.map(r => ({ id: r.id, score: r.score })),
        procedure: procedureResults.map(r => ({ id: r.id, score: r.score })),
        recent_thoughts: recentThoughts.map(t => ({ id: t.id })),
      };

      const parts: string[] = [];
      if (factualResults.length > 0) {
        const entries = factualResults
          .map(r => `- [${r.id}] ${r.text.trim()}`)
          .join("\n");
        parts.push(`Relevant memories:\n${entries}`);
      }
      if (procedureResults.length > 0) {
        const proc = procedureResults[0]!;
        const text =
          proc.text.length <= this.procedureBudget
            ? proc.text.trim()
            : proc.text.trim().slice(0, this.procedureBudget) + "…";
        parts.push(`Relevant procedure:\n${text}`);
      }
      if (recentThoughts.length > 0) {
        parts.push(
          `Recent thoughts:\n${recentThoughts
            .map(t => `- ${t.text.trim().slice(0, this.MAX_MEMORY_TEXT_LENGTH)}`)
            .join("\n")}`,
        );
      }

      return parts.join("\n\n");
    } catch {
      return "";
    }
  }

  /**
   * Maximal Marginal Relevance selection.
   * Selects up to maxCount diverse results from candidates that fit within budgetChars.
   * lambda controls the relevance vs diversity tradeoff (higher = more relevance).
   */
  private selectWithMMR(
    candidates: Array<{ id: string; text: string; score: number; embedding: Float32Array }>,
    budgetChars: number,
    maxCount: number,
    lambda: number,
  ): Array<{ id: string; text: string; score: number }> {
    const selected: Array<{ id: string; text: string; score: number; embedding: Float32Array }> = [];
    const remaining = [...candidates];
    let budgetRemaining = budgetChars;

    while (remaining.length > 0 && selected.length < maxCount && budgetRemaining > 0) {
      let bestIndex = 0;
      let bestScore = -Infinity;

      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]!;
        let mmrScore: number;
        if (selected.length === 0) {
          mmrScore = lambda * candidate.score;
        } else {
          const maxSim = Math.max(
            ...selected.map(s => this.db.cosSim(candidate.embedding, s.embedding)),
          );
          mmrScore = lambda * candidate.score - (1 - lambda) * maxSim;
        }
        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIndex = i;
        }
      }

      const pick = remaining[bestIndex]!;
      // Swap-to-end then pop: O(1) removal vs O(n) for splice. Order in `remaining`
      // doesn't matter because every iteration re-scores all candidates anyway.
      remaining[bestIndex] = remaining[remaining.length - 1]!;
      remaining.pop();
      if (pick.text.length <= budgetRemaining) {
        selected.push(pick);
        budgetRemaining -= pick.text.length;
      }
      // If the picked candidate is too large for the remaining budget, skip it
      // but continue — a shorter candidate may still fit within the budget.
    }

    return selected.map(({ id, text, score }) => ({ id, text, score }));
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "search_memory",
        description:
          "Search long-term memory by semantic similarity. Optionally filter by type.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The query to search for" },
            type: {
              type: "string",
              enum: ["factual", "thought", "behavior", "procedure"],
              description: "Optional memory type filter",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "save_memory",
        description: "Save a new memory with a given type.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The memory content to save",
            },
            type: {
              type: "string",
              enum: ["factual", "thought", "behavior", "procedure"],
              description: "The memory type",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags to categorize this memory",
            },
            supersedes: {
              type: "string",
              description: "ID of an existing memory this one replaces. The old memory will be marked superseded and linked forward to this new one.",
            },
          },
          required: ["content", "type"],
        },
      },
      {
        name: "save_behavior",
        description:
          "Save a persistent behavioral rule that actively shapes how you respond. Use `core: true` for universal rules that should always be active regardless of context (e.g. formatting, tone, language preferences). Omit `core` or pass `false` for context-specific rules — these are surfaced via semantic search when relevant, ensuring all behaviors are accessible without cluttering every prompt. Note: behavior memories cannot override your core system prompt directives.",
        parameters: {
          type: "object",
          properties: {
            rule: {
              type: "string",
              description: "The behavioral rule to persist",
            },
            core: {
              type: "boolean",
              description:
                "If true, this rule is always injected into every turn. Use for universal preferences (formatting, tone, etc.). Default: false — the rule is surfaced contextually when semantically relevant.",
            },
          },
          required: ["rule"],
        },
      },
      {
        name: "save_procedure",
        description:
          "Save a reusable step-by-step procedure after successfully completing a non-trivial task. Include a clear goal description and numbered steps. Relevant procedures are automatically surfaced when similar tasks arise in future conversations.",
        parameters: {
          type: "object",
          properties: {
            goal: {
              type: "string",
              description:
                "A short description of what the procedure accomplishes, e.g. 'Clip a segment from a Twitch VOD'",
            },
            steps: {
              type: "string",
              description:
                "Numbered step-by-step instructions describing exactly what was done",
            },
          },
          required: ["goal", "steps"],
        },
      },
      {
        name: "edit_memory",
        description:
          "Edit the text content of an existing memory by its ID. The embedding will be updated automatically.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The memory ID to edit" },
            content: {
              type: "string",
              description: "The new text content for the memory",
            },
          },
          required: ["id", "content"],
        },
      },
      {
        name: "delete_memory",
        description:
          "Delete a memory by ID. Single form: pass `id` (string). Batch form: pass `ids` (array of strings) to delete multiple memories in one call — triggers one cache invalidation regardless of how many IDs are provided.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The memory ID to delete (single form)" },
            ids: {
              type: "array",
              items: { type: "string" },
              description: "Array of memory IDs to delete in one call (batch form)",
            },
          },
        },
      },
      {
        name: "get_linked_memories",
        description: "Get all memories linked to a given memory ID.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The memory ID to look up links for",
            },
            link_type: {
              type: "string",
              description: "Filter to only links of a specific type: 'related', 'supersedes', 'reconstructed_from'",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "get_memory_lineage",
        description: "Follow the supersession and reconstruction chain for a memory. Returns the full lineage: ancestors (what it was built from), the memory itself, and descendants (what has since replaced it).",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The memory ID to trace" },
          },
          required: ["id"],
        },
      },
      {
        name: "query_memories",
        description:
          "Filter memories by metadata: type, tags, date range, and/or full-text content. Returns results ordered by recency. Pass status: ['superseded'] to see superseded memories.",
        parameters: {
          type: "object",
          properties: {
            types: {
              type: "array",
              items: {
                type: "string",
                enum: ["factual", "thought", "behavior", "procedure"],
              },
              description: "Filter by memory types",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Filter by tags (all must match)",
            },
            after: {
              type: "string",
              description: "ISO date string - only memories after this date",
            },
            before: {
              type: "string",
              description: "ISO date string - only memories before this date",
            },
            contains: {
              type: "string",
              description: "Full-text search term",
            },
            limit: {
              type: "number",
              description: "Max results (default 20)",
            },
            status: {
              type: "array",
              items: { type: "string" },
              description: "Filter by status. Default: ['active']. Pass ['superseded'] to see superseded memories.",
            },
          },
        },
      },
      {
        name: "hybrid_search",
        description:
          "Combine semantic similarity search with metadata filters. When a 'contains' text filter is provided, BM25 lexical scores are fused with vector scores for more precise results.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The semantic search query" },
            types: {
              type: "array",
              items: {
                type: "string",
                enum: ["factual", "thought", "behavior", "procedure"],
              },
              description: "Filter by memory types",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Filter by tags",
            },
            after: {
              type: "string",
              description: "ISO date string - only memories after this date",
            },
            before: {
              type: "string",
              description: "ISO date string - only memories before this date",
            },
            contains: {
              type: "string",
              description: "Full-text search term (enables BM25 + vector fusion)",
            },
            limit: {
              type: "number",
              description: "Max results (default 5)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "aggregate_memories",
        description:
          "Get counts grouped by type, tag, or date. Useful for understanding the shape of memory.",
        parameters: {
          type: "object",
          properties: {
            group_by: {
              type: "string",
              enum: ["type", "tag", "date"],
              description: "The dimension to group by",
            },
            filter: {
              type: "object",
              description:
                "Optional filter (same shape as query_memories params)",
            },
          },
          required: ["group_by"],
        },
      },
      {
        name: "get_memory_timeline",
        description:
          "Retrieve memories in chronological order within an optional date range.",
        parameters: {
          type: "object",
          properties: {
            start: {
              type: "string",
              description: "ISO date string for range start",
            },
            end: {
              type: "string",
              description: "ISO date string for range end",
            },
            limit: {
              type: "number",
              description: "Max results (default 20)",
            },
          },
        },
      },
      {
        name: "memory_retrieval_trace",
        description:
          "Returns the retrieval trace from the most recent automatic context fetch. Shows which memory IDs were retrieved, their similarity scores, and the selection method. Use for debugging memory relevance.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    try {
      if (name === "search_memory") return await this.handleSearchMemory(args);
      if (name === "save_memory") return await this.handleSaveMemory(args);
      if (name === "save_behavior") return await this.handleSaveBehavior(args);
      if (name === "save_procedure") return await this.handleSaveProcedure(args);
      if (name === "edit_memory") return await this.handleEditMemory(args);
      if (name === "delete_memory") return await this.handleDeleteMemory(args);
      if (name === "get_linked_memories") return await this.handleGetLinkedMemories(args);
      if (name === "get_memory_lineage") return JSON.stringify(await this.db.getLineage(args.id), null, 2);
      if (name === "query_memories") return this.handleQueryMemories(args);
      if (name === "hybrid_search") return await this.handleHybridSearch(args);
      if (name === "aggregate_memories") return this.handleAggregateMemories(args);
      if (name === "get_memory_timeline") return this.handleGetMemoryTimeline(args);
      if (name === "memory_retrieval_trace") return this.handleMemoryRetrievalTrace();
    } catch (e) {
      logger.error(this.name, `Tool error (${name}):`, e);
      return `Tool error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private async handleSearchMemory(args: any): Promise<string> {
    logger.info(
      this.name,
      `search_memory: "${args.query}"${args.type ? ` type=${args.type}` : ""}`,
    );
    const { results, meta } = await this.db.searchWithStats(args.query, 5, 0.4, args.type);
    this.searchMetaBuffer.set("search_memory", { ...meta, result_count: results.length });
    logger.debug(this.name, `search_memory found ${results.length} results`);
    if (results.length === 0) return "No relevant memories found.";
    return results
      .map(r => {
        const raw = r.text.trim();
        const text =
          raw.length > this.MAX_MEMORY_TEXT_LENGTH
            ? raw.slice(0, this.MAX_MEMORY_TEXT_LENGTH) + "…"
            : raw;
        return `[${r.id}] (score: ${r.score.toFixed(2)}) ${text}`;
      })
      .join("\n");
  }

  private async handleSaveMemory(args: any): Promise<string> {
    const content = String(args.content);
    if (content.length > MAX_CONTENT_LENGTH) {
      return `Memory content too long (${content.length} chars). Maximum is ${MAX_CONTENT_LENGTH} characters.`;
    }
    logger.info(
      this.name,
      `save_memory type=${args.type ?? "factual"}: "${content.slice(0, 100)}"`,
    );
    const supersedes = typeof args.supersedes === "string" ? args.supersedes : undefined;
    const id = await this.db.addMemory(content, args.type ?? "factual", args.tags ?? [], undefined, undefined, supersedes);
    this.savedThisTurn.add(id);
    this.savedThisTurnTexts.set(id, content);
    logger.info(this.name, `save_memory SUCCESS id=${id}`);
    // Supersede near-duplicate active memories (score >= 0.9) using the saved content as query
    const nearDups = await this.db.search(content, 5, 0.9, args.type ?? "factual");
    let supersededCount = 0;
    const supersededIds = new Set<string>();
    for (const s of nearDups) {
      if (s.id !== id) {
        await this.db.updateMemoryStatus(s.id, "superseded");
        supersededIds.add(s.id);
        supersededCount++;
      }
    }
    if (supersededCount > 0) {
      logger.info(this.name, `save_memory: superseded ${supersededCount} near-duplicate(s)`);
    }
    // Link to top 3 similar active memories (excluding superseded ones)
    const similar = await this.db.search(content, 3, 0.5);
    const linkable = similar.filter(s => s.id !== id && !supersededIds.has(s.id));
    logger.debug(this.name, `save_memory linking to ${linkable.length} similar memories`);
    for (const s of linkable) {
      await this.db.linkMemories(id, s.id);
    }
    return `Memory saved (type: ${args.type ?? "factual"}, id: ${id}).`;
  }

  private async handleSaveBehavior(args: any): Promise<string> {
    const rule = String(args.rule);
    if (rule.length > MAX_CONTENT_LENGTH) {
      return `Behavior rule too long (${rule.length} chars). Maximum is ${MAX_CONTENT_LENGTH} characters.`;
    }
    const isCore = args.core === true;
    const tags = isCore ? ["core"] : [];
    logger.info(this.name, `save_behavior${isCore ? " [core]" : ""}: "${rule.slice(0, 100)}"`);
    const id = await this.db.addMemory(rule, "behavior", tags);
    // Only invalidate core behavior cache when a core behavior is saved
    if (isCore) this.coreBehaviorCache = null;
    return `Memory saved (type: behavior, core: ${isCore}, id: ${id}).`;
  }

  private async handleSaveProcedure(args: any): Promise<string> {
    const goal = String(args.goal);
    const steps = String(args.steps);
    const combined = `[PROCEDURE] ${goal}\n${steps}`;
    if (combined.length > MAX_CONTENT_LENGTH) {
      return `Procedure content too long (${combined.length} chars). Maximum is ${MAX_CONTENT_LENGTH} characters.`;
    }
    logger.info(this.name, `save_procedure: "${goal.slice(0, 100)}"`);
    const id = await this.db.addMemory(combined, "procedure");
    return `Memory saved (type: procedure, id: ${id}).`;
  }

  private async handleEditMemory(args: any): Promise<string> {
    const content = String(args.content);
    if (content.length > MAX_CONTENT_LENGTH) {
      return `Memory content too long (${content.length} chars). Maximum is ${MAX_CONTENT_LENGTH} characters.`;
    }
    logger.info(this.name, `edit_memory id=${args.id}: "${content.slice(0, 100)}"`);
    const existing = await this.db.getMemoryById(args.id);
    if (!existing) return `No memory found with id ${args.id}.`;
    // Invalidate core behavior cache only if editing a core behavior
    const isEditingCoreBehavior =
      existing.type === "behavior" && (existing.tags ?? []).includes("core");
    await this.db.updateMemoryText(args.id, content);
    if (isEditingCoreBehavior) this.coreBehaviorCache = null;
    logger.info(this.name, `edit_memory SUCCESS id=${args.id}`);
    return `Memory ${args.id} updated.`;
  }

  private async handleDeleteMemory(args: any): Promise<string> {
    // Batch path
    if (Array.isArray(args.ids) && args.ids.length > 0) {
      let deleted = 0;
      let missing = 0;
      let invalid = 0;
      let invalidateCache = false;
      for (const id of args.ids) {
        if (typeof id !== "string" || !id.trim()) {
          invalid++;
          continue;
        }
        const existing = await this.db.getMemoryById(id);
        if (!existing) {
          missing++;
          continue;
        }
        if (existing.type === "behavior" && (existing.tags ?? []).includes("core")) {
          invalidateCache = true;
        }
        await this.db.deleteMemory(id);
        deleted++;
      }
      if (invalidateCache) this.coreBehaviorCache = null;
      return `Batch delete: ${deleted} deleted, ${missing} not found, ${invalid} invalid out of ${args.ids.length} requested.`;
    }

    // Empty ids array — explicit error rather than confusing fallthrough
    if (Array.isArray(args.ids) && args.ids.length === 0) {
      return "delete_memory error: 'ids' array is empty — provide at least one ID.";
    }

    // Single-delete path
    if (!args.id || typeof args.id !== "string") {
      return "delete_memory requires a valid memory id string.";
    }
    logger.info(this.name, `delete_memory id=${args.id}`);
    const existing = await this.db.getMemoryById(args.id);
    if (!existing) return `No memory found with id ${args.id}.`;
    const wasCoreBehavior =
      existing.type === "behavior" && (existing.tags ?? []).includes("core");
    await this.db.deleteMemory(args.id);
    if (wasCoreBehavior) this.coreBehaviorCache = null;
    return `Memory ${args.id} deleted.`;
  }

  private async handleGetLinkedMemories(args: any): Promise<string> {
    if (!args.id || typeof args.id !== "string") {
      return "get_linked_memories requires a valid memory id string.";
    }
    const linkType = typeof args.link_type === "string" ? args.link_type : undefined;
    logger.debug(this.name, `get_linked_memories id=${args.id}${linkType ? ` link_type=${linkType}` : ""}`);
    const linked = await this.db.getLinkedMemories(args.id, linkType);
    logger.debug(this.name, `get_linked_memories found ${linked.length} links`);
    if (linked.length === 0) return "No linked memories found.";
    return linked.map(m => `[${m.id}] (${m.link_type}) ${m.text.trim()}`).join("\n");
  }

  private handleQueryMemories(args: any): string {
    logger.info(this.name, `query_memories: ${JSON.stringify(args)}`);
    const filter: MemoryFilter = this.buildFilter(args);
    const results = this.db.queryMemories(filter);
    logger.debug(this.name, `query_memories found ${results.length} results`);
    if (results.length === 0) return "No memories match the given filter.";
    return results
      .map(r => {
        const raw = r.text.trim();
        const text =
          raw.length > this.MAX_MEMORY_TEXT_LENGTH
            ? raw.slice(0, this.MAX_MEMORY_TEXT_LENGTH) + "…"
            : raw;
        const tagsStr = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
        const date = new Date(r.timestamp).toISOString().slice(0, 10);
        return `[${r.id}] (${r.type}, ${date}${tagsStr}) ${text}`;
      })
      .join("\n");
  }

  private async handleHybridSearch(args: any): Promise<string> {
    logger.info(this.name, `hybrid_search: "${args.query}"`);
    const filter: MemoryFilter = this.buildFilter(args);
    const limit = args.limit ?? 5;
    // Fetch more candidates than needed so MMR has room to diversify
    const candidateLimit = Math.max(limit * 2, 10);
    const candidates = await this.db.hybridSearch(args.query, filter, candidateLimit, 0.4);

    // Apply MMR diversity selection using stored embeddings
    let finalResults = candidates;
    if (candidates.length > 1) {
      const embeddingMap = this.db.getEmbeddingsByIds(candidates.map(r => r.id));
      const withEmbeddings = candidates
        .filter(r => embeddingMap.has(r.id))
        .map(r => ({ ...r, embedding: embeddingMap.get(r.id)! }));
      if (withEmbeddings.length > 0) {
        // Pass MAX_SAFE_INTEGER as budget to disable char-budget constraint — only diversity/count matters here
        const mmrSelected = this.selectWithMMR(withEmbeddings, Number.MAX_SAFE_INTEGER, limit, 0.6);
        const orderedIds = mmrSelected.map(s => s.id);
        const idToResult = new Map(candidates.map(r => [r.id, r]));
        finalResults = orderedIds.map(id => idToResult.get(id)!).filter(Boolean);
      }
    }

    const retrievalMethod = filter.contains ? "hybrid" : "semantic";
    this.searchMetaBuffer.set("hybrid_search", {
      total_candidates: candidates.length,
      result_count: finalResults.length,
      retrieval_method: retrievalMethod,
      filter_applied: [
        ...(filter.types ?? []).map(t => `type=${t}`),
        ...(filter.tags ?? []).map(t => `tag=${t}`),
        ...(filter.contains ? [`contains=${filter.contains}`] : []),
      ],
    });
    logger.debug(this.name, `hybrid_search: ${candidates.length} candidates → ${finalResults.length} after MMR (method: ${retrievalMethod})`);
    if (finalResults.length === 0) return "No memories match the given query and filters.";
    return finalResults
      .map(r => {
        const raw = r.text.trim();
        const text =
          raw.length > this.MAX_MEMORY_TEXT_LENGTH
            ? raw.slice(0, this.MAX_MEMORY_TEXT_LENGTH) + "…"
            : raw;
        const tagsStr = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
        const date = new Date(r.timestamp).toISOString().slice(0, 10);
        return `[${r.id}] (score: ${r.score.toFixed(2)}, ${r.type}, ${date}${tagsStr}) ${text}`;
      })
      .join("\n");
  }

  private handleAggregateMemories(args: any): string {
    logger.info(this.name, `aggregate_memories group_by=${args.group_by}`);
    let filter: MemoryFilter | undefined = undefined;
    if (args.filter && typeof args.filter === "object") {
      filter = this.buildFilter(args.filter);
    }
    const results = this.db.aggregateMemories(args.group_by, filter);
    logger.debug(this.name, `aggregate_memories found ${results.length} groups`);
    if (results.length === 0) return "No memories found.";
    const header = `${"Group".padEnd(30)} Count`;
    const divider = "-".repeat(36);
    const rows = results.map(r => `${r.group.padEnd(30)} ${r.count}`);
    return [header, divider, ...rows].join("\n");
  }

  private handleGetMemoryTimeline(args: any): string {
    logger.info(this.name, `get_memory_timeline start=${args.start} end=${args.end}`);
    const start = this.parseDateArg(args.start);
    const end = this.parseDateArg(args.end);
    const results = this.db.getMemoryTimeline(start, end, args.limit ?? 20);
    logger.debug(this.name, `get_memory_timeline found ${results.length} memories`);
    if (results.length === 0) return "No memories found in the given time range.";
    return results
      .map(r => {
        const raw = r.text.trim();
        const text =
          raw.length > this.MAX_MEMORY_TEXT_LENGTH
            ? raw.slice(0, this.MAX_MEMORY_TEXT_LENGTH) + "…"
            : raw;
        const tagsStr = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
        const date = new Date(r.timestamp).toISOString().replace("T", " ").slice(0, 19);
        return `[${r.id}] (${r.type}, ${date}${tagsStr}) ${text}`;
      })
      .join("\n");
  }

  private handleMemoryRetrievalTrace(): string {
    if (!this.lastRetrievalTrace) return "No retrieval trace available yet.";
    return JSON.stringify(this.lastRetrievalTrace, null, 2);
  }

  /**
   * Build a MemoryFilter from raw LLM args, validating date fields to avoid
   * NaN timestamps from invalid date strings.
   */
  private buildFilter(args: any): MemoryFilter {
    return {
      types: Array.isArray(args.types) ? args.types : undefined,
      tags: Array.isArray(args.tags) ? args.tags : undefined,
      after: typeof args.after === "string" ? args.after : undefined,
      before: typeof args.before === "string" ? args.before : undefined,
      contains: typeof args.contains === "string" ? args.contains : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      status: Array.isArray(args.status) ? args.status : undefined,
      scope: typeof args.scope === "string" ? args.scope : undefined,
    };
  }

  /**
   * Parse an ISO date string arg, returning undefined if the value is absent
   * or not a valid date (avoids NaN timestamps in database queries).
   */
  private parseDateArg(value: unknown): number | undefined {
    if (!value || typeof value !== "string") return undefined;
    const ms = new Date(value).getTime();
    return isNaN(ms) ? undefined : ms;
  }

  /**
   * Classify the relationship between a newly-saved memory (newText) and an existing
   * candidate memory (oldText) that scored >= 0.85 against the current turn's query.
   *
   * - CORRECTION: new text contains a negation keyword → old is wrong, supersede it.
   * - SUPPLEMENT: everything else → adds context, link both and keep active.
   *
   * Note: exact/near-duplicates (score >= 0.9) are already handled by the near-duplicate
   * guard in handleSaveMemory() and will not reach this method (they are superseded before
   * onMessage() runs and are excluded from the active-only search). This method therefore
   * only sees candidates in the 0.85–0.89 range.
   *
   * No LLM calls — pure text heuristic.
   */
  private classifyRelationship(
    newText: string,
    _oldText: string,
    _score: number,
  ): "CORRECTION" | "SUPPLEMENT" {
    const CORRECTION_KEYWORDS = [
      "no longer", "not anymore", "changed", "updated",
      "incorrect", "wrong", "instead", "actually", "correction",
      "was wrong", "mistaken",
    ];
    const lower = newText.toLowerCase();
    if (CORRECTION_KEYWORDS.some(kw => lower.includes(kw))) return "CORRECTION";
    return "SUPPLEMENT";
  }

  async onMessage(
    role: "user" | "assistant" | "system",
    content: string,
    _source: string,
  ): Promise<void> {
    if (role !== "assistant") return;
    // Skip conflict resolution when no new memories were saved this turn —
    // conflicts are most likely when fresh memories were just written.
    if (this.savedThisTurn.size === 0) return;
    // Guard: require event context to form a focused conflict query.
    if (this.currentEvents.length === 0) return;
    // Autonomous conflict resolution
    // Note: the near-duplicate guard in handleSaveMemory() already handles score >= 0.9
    // matches at save time. This runs at 0.85 to catch the 0.85–0.89 range that slipped through.
    try {
      const conflictQuery = this.currentEvents.join(" ") + " " + content;
      logger.debug(this.name, "onMessage: running autonomous conflict resolution");
      const candidates = await this.db.search(conflictQuery, 5, 0.85);
      logger.debug(this.name, `onMessage: found ${candidates.length} conflict candidates`);

      for (const candidate of candidates) {
        if (this.savedThisTurn.has(candidate.id)) continue;
        const mem = await this.db.getMemoryById(candidate.id);
        if (!mem) continue;

        // Classify each (newMemory, candidate) pair independently
        for (const [newId, newText] of this.savedThisTurnTexts) {
          const classification = this.classifyRelationship(newText, mem.text, candidate.score);

          if (classification === "CORRECTION") {
            logger.info(this.name, `CORRECTION: marking memory superseded id=${candidate.id} (new id=${newId})`);
            await this.db.updateMemoryStatus(candidate.id, "superseded");
            break; // one CORRECTION is enough for this candidate
          } else {
            // SUPPLEMENT: link both, keep both active
            logger.info(this.name, `SUPPLEMENT: linking memory id=${newId} ↔ ${candidate.id}`);
            await this.db.linkMemories(newId, candidate.id, "related");
          }
        }
      }
    } catch (e) {
      logger.error(this.name, "Autonomous memory management error:", e);
    }
  }
}
