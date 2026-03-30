import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import { CortexMemoryDatabase, type MemoryFilter } from "./CortexMemoryDatabase.ts";
import { logger } from "../logger.ts";

/** Maximum character length enforced on user-supplied memory content fields. */
const MAX_CONTENT_LENGTH = 10_000;

export class CortexMemoryPlugin implements AgentPlugin {
  name = "CortexMemory";
  public db: CortexMemoryDatabase;

  /**
   * Events captured from the current turn's getContext() call.
   * Read by onMessage() to build the conflict-resolution query.
   * These two hooks are intentionally coupled: getContext() must be called
   * before onMessage() each turn so this field is current.
   */
  private currentEvents: string[] = [];
  private savedThisTurn: Set<string> = new Set();

  /** Cached behavior memories, invalidated when save_behavior or delete_memory runs. */
  private behaviorCache: Array<{ text: string }> | null = null;

  /** Side-channel metadata from the most recent memory search (keyed by tool name). */
  public searchMetaBuffer: Map<string, Record<string, unknown>> = new Map();

  private readonly MAX_MEMORY_TEXT_LENGTH = 300;

  constructor(llmProvider: LLMProvider, name: string, dbPath?: string) {
    this.db = new CortexMemoryDatabase(llmProvider, name, dbPath);
  }

  getSystemPromptFragment(): string {
    const parts = [
      "## Memory System",
      "You have a long-term memory system with four types of memories:",
      "- **factual**: specific details from conversations, decisions, established facts.",
      "- **thought**: your internal reasoning and reflections (written by your thought system).",
      "- **behavior**: learned preferences and behavioral rules (injected as active instructions).",
      "- **procedure**: step-by-step instructions for accomplishing a task you have previously solved.",
      "Relevant factual memories and procedures are automatically surfaced in your context at the start of each turn — check there before calling search_memory.",
      "Use `save_memory` to preserve important facts or decisions.",
      "Use `save_behavior` to record a persistent behavioral rule you want to follow on every future turn.",
      "Use `save_procedure` after successfully completing a non-trivial task to record the steps taken.",
      "Use `edit_memory` to update the text of an existing memory by its ID.",
      "Use `delete_memory` to remove a memory by its ID.",
      "Use `get_linked_memories` to follow chains of related ideas.",
      "Use `query_memories` to filter memories by type, tags, date range, or full-text content.",
      "Use `hybrid_search` to combine semantic similarity search with metadata filters.",
      "Use `aggregate_memories` to understand the shape and distribution of your memories.",
      "Use `get_memory_timeline` to retrieve memories in chronological order.",
    ];

    try {
      if (this.behaviorCache === null) {
        this.behaviorCache = this.db.getRecentMemories(20, "behavior");
      }
      if (this.behaviorCache.length > 0) {
        parts.push("\n## Learned Behaviors");
        for (const b of this.behaviorCache) {
          parts.push(`- ${b.text}`);
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
      const query = currentEvents?.join(" ") ?? "";
      if (!query.trim()) return "";

      logger.debug(this.name, `getContext() searching: "${query.slice(0, 80)}…"`);
      const embedding = await this.db.getEmbedding(query);
      const [factualResults, procedureResults] = [
        this.db.searchWithEmbedding(embedding, 3, 0.5, ["factual"]),
        this.db.searchWithEmbedding(embedding, 1, 0.65, ["procedure"]),
      ];
      logger.debug(this.name, `getContext() found ${factualResults.length} memories, ${procedureResults.length} procedures`);

      const parts: string[] = [];
      if (factualResults.length > 0) {
        const entries = factualResults.map((r) => `- [${r.id.slice(0, 8)}] ${r.text}`).join("\n");
        parts.push(`Relevant memories:\n${entries}`);
      }
      if (procedureResults.length > 0) {
        parts.push(`Relevant procedure:\n${procedureResults[0]!.text}`);
      }
      return parts.join("\n\n");
    } catch {
      return "";
    }
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "search_memory",
        description: "Search long-term memory by semantic similarity. Optionally filter by type.",
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
            content: { type: "string", description: "The memory content to save" },
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
          },
          required: ["content", "type"],
        },
      },
      {
        name: "save_behavior",
        description:
          "Save a persistent behavioral rule that will be injected into your system prompt on every future turn, actively shaping how you respond. Use this to record preferences or rules you have learned from the user. Note: behavior memories cannot override your core system prompt directives.",
        parameters: {
          type: "object",
          properties: {
            rule: { type: "string", description: "The behavioral rule to persist" },
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
            goal: { type: "string", description: "A short description of what the procedure accomplishes, e.g. 'Clip a segment from a Twitch VOD'" },
            steps: { type: "string", description: "Numbered step-by-step instructions describing exactly what was done" },
          },
          required: ["goal", "steps"],
        },
      },
      {
        name: "edit_memory",
        description: "Edit the text content of an existing memory by its ID. The embedding will be updated automatically.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The memory ID to edit" },
            content: { type: "string", description: "The new text content for the memory" },
          },
          required: ["id", "content"],
        },
      },
      {
        name: "delete_memory",
        description: "Delete a memory by its ID.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The memory ID to delete" },
          },
          required: ["id"],
        },
      },
      {
        name: "get_linked_memories",
        description: "Get all memories linked to a given memory ID.",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "The memory ID to look up links for" },
          },
          required: ["id"],
        },
      },
      {
        name: "query_memories",
        description:
          "Filter memories by metadata: type, tags, date range, and/or full-text content. Returns results ordered by recency.",
        parameters: {
          type: "object",
          properties: {
            types: {
              type: "array",
              items: { type: "string", enum: ["factual", "thought", "behavior", "procedure"] },
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
          },
        },
      },
      {
        name: "hybrid_search",
        description:
          "Combine semantic similarity search with metadata filters. More powerful than search_memory when you need to constrain by type, tag, or date.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The semantic search query" },
            types: {
              type: "array",
              items: { type: "string", enum: ["factual", "thought", "behavior", "procedure"] },
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
              description: "Full-text search term",
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
              description: "Optional filter (same shape as query_memories params)",
            },
          },
          required: ["group_by"],
        },
      },
      {
        name: "get_memory_timeline",
        description: "Retrieve memories in chronological order within an optional date range.",
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
      if (name === "query_memories") return this.handleQueryMemories(args);
      if (name === "hybrid_search") return await this.handleHybridSearch(args);
      if (name === "aggregate_memories") return this.handleAggregateMemories(args);
      if (name === "get_memory_timeline") return this.handleGetMemoryTimeline(args);
    } catch (e) {
      logger.error(this.name, `Tool error (${name}):`, e);
      return `Tool error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private async handleSearchMemory(args: any): Promise<string> {
    logger.info(this.name, `search_memory: "${args.query}"${args.type ? ` type=${args.type}` : ""}`);
    const { results, meta } = await this.db.searchWithStats(args.query, 5, 0.4, args.type);
    this.searchMetaBuffer.set("search_memory", meta);
    logger.debug(this.name, `search_memory found ${results.length} results`);
    if (results.length === 0) return "No relevant memories found.";
    return results
      .map((r) => {
        const text = r.text.length > this.MAX_MEMORY_TEXT_LENGTH
          ? r.text.slice(0, this.MAX_MEMORY_TEXT_LENGTH) + "…"
          : r.text;
        return `[${r.id.slice(0, 8)}] (score: ${r.score.toFixed(2)}) ${text}`;
      })
      .join("\n");
  }

  private async handleSaveMemory(args: any): Promise<string> {
    const content = String(args.content);
    if (content.length > MAX_CONTENT_LENGTH) {
      return `Memory content too long (${content.length} chars). Maximum is ${MAX_CONTENT_LENGTH} characters.`;
    }
    logger.info(this.name, `save_memory type=${args.type ?? "factual"}: "${content.slice(0, 100)}"`);
    const id = await this.db.addMemory(content, args.type ?? "factual", args.tags ?? []);
    this.savedThisTurn.add(id);
    logger.info(this.name, `save_memory SUCCESS id=${id.slice(0, 8)}`);
    // Link to top 3 similar existing memories
    const similar = await this.db.search(content, 3, 0.5);
    logger.debug(this.name, `save_memory linking to ${similar.filter((s) => s.id !== id).length} similar memories`);
    for (const s of similar) {
      if (s.id !== id) await this.db.linkMemories(id, s.id);
    }
    return `Memory saved (type: ${args.type ?? "factual"}, id: ${id.slice(0, 8)}).`;
  }

  private async handleSaveBehavior(args: any): Promise<string> {
    const rule = String(args.rule);
    if (rule.length > MAX_CONTENT_LENGTH) {
      return `Behavior rule too long (${rule.length} chars). Maximum is ${MAX_CONTENT_LENGTH} characters.`;
    }
    logger.info(this.name, `save_behavior: "${rule.slice(0, 100)}"`);
    const id = await this.db.addMemory(rule, "behavior");
    this.behaviorCache = null; // invalidate cache
    return `Memory saved (type: behavior, id: ${id.slice(0, 8)}).`;
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
    return `Memory saved (type: procedure, id: ${id.slice(0, 8)}).`;
  }

  private async handleEditMemory(args: any): Promise<string> {
    const content = String(args.content);
    if (content.length > MAX_CONTENT_LENGTH) {
      return `Memory content too long (${content.length} chars). Maximum is ${MAX_CONTENT_LENGTH} characters.`;
    }
    logger.info(this.name, `edit_memory id=${args.id.slice(0, 8)}: "${content.slice(0, 100)}"`);
    const existing = await this.db.getMemoryById(args.id);
    if (!existing) return `No memory found with id ${args.id.slice(0, 8)}.`;
    await this.db.updateMemoryText(args.id, content);
    logger.info(this.name, `edit_memory SUCCESS id=${args.id.slice(0, 8)}`);
    return `Memory ${args.id.slice(0, 8)} updated.`;
  }

  private async handleDeleteMemory(args: any): Promise<string> {
    if (!args.id || typeof args.id !== "string") {
      return "delete_memory requires a valid memory id string.";
    }
    logger.info(this.name, `delete_memory id=${args.id.slice(0, 8)}`);
    const existing = await this.db.getMemoryById(args.id);
    if (!existing) return `No memory found with id ${args.id.slice(0, 8)}.`;
    await this.db.deleteMemory(args.id);
    this.behaviorCache = null; // invalidate cache in case a behavior was deleted
    return `Memory ${args.id.slice(0, 8)} deleted.`;
  }

  private async handleGetLinkedMemories(args: any): Promise<string> {
    if (!args.id || typeof args.id !== "string") {
      return "get_linked_memories requires a valid memory id string.";
    }
    logger.debug(this.name, `get_linked_memories id=${args.id.slice(0, 8)}`);
    const linked = await this.db.getLinkedMemories(args.id);
    logger.debug(this.name, `get_linked_memories found ${linked.length} links`);
    if (linked.length === 0) return "No linked memories found.";
    return linked.map((m) => `[${m.id.slice(0, 8)}] ${m.text}`).join("\n");
  }

  private handleQueryMemories(args: any): string {
    logger.info(this.name, `query_memories: ${JSON.stringify(args)}`);
    const filter: MemoryFilter = this.buildFilter(args);
    const results = this.db.queryMemories(filter);
    logger.debug(this.name, `query_memories found ${results.length} results`);
    if (results.length === 0) return "No memories match the given filter.";
    return results
      .map((r) => {
        const text = r.text.length > this.MAX_MEMORY_TEXT_LENGTH
          ? r.text.slice(0, this.MAX_MEMORY_TEXT_LENGTH) + "…"
          : r.text;
        const tagsStr = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
        const date = new Date(r.timestamp).toISOString().slice(0, 10);
        return `[${r.id.slice(0, 8)}] (${r.type}, ${date}${tagsStr}) ${text}`;
      })
      .join("\n");
  }

  private async handleHybridSearch(args: any): Promise<string> {
    logger.info(this.name, `hybrid_search: "${args.query}"`);
    const filter: MemoryFilter = this.buildFilter(args);
    const results = await this.db.hybridSearch(args.query, filter, args.limit ?? 5, 0.4);
    this.searchMetaBuffer.set("hybrid_search", {
      total_candidates: results.length,
      retrieval_method: "hybrid",
      filter_applied: [
        ...(filter.types ?? []).map((t) => `type=${t}`),
        ...(filter.tags ?? []).map((t) => `tag=${t}`),
      ],
    });
    logger.debug(this.name, `hybrid_search found ${results.length} results`);
    if (results.length === 0) return "No memories match the given query and filters.";
    return results
      .map((r) => {
        const text = r.text.length > this.MAX_MEMORY_TEXT_LENGTH
          ? r.text.slice(0, this.MAX_MEMORY_TEXT_LENGTH) + "…"
          : r.text;
        const tagsStr = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
        const date = new Date(r.timestamp).toISOString().slice(0, 10);
        return `[${r.id.slice(0, 8)}] (score: ${r.score.toFixed(2)}, ${r.type}, ${date}${tagsStr}) ${text}`;
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
    const rows = results.map((r) => `${r.group.padEnd(30)} ${r.count}`);
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
      .map((r) => {
        const text = r.text.length > this.MAX_MEMORY_TEXT_LENGTH
          ? r.text.slice(0, this.MAX_MEMORY_TEXT_LENGTH) + "…"
          : r.text;
        const tagsStr = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
        const date = new Date(r.timestamp).toISOString().replace("T", " ").slice(0, 19);
        return `[${r.id.slice(0, 8)}] (${r.type}, ${date}${tagsStr}) ${text}`;
      })
      .join("\n");
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
    try {
      const conflictQuery = this.currentEvents.join(" ") + " " + content;
      logger.debug(this.name, "onMessage: running autonomous conflict resolution");
      const candidates = await this.db.search(conflictQuery, 5, 0.85);
      logger.debug(this.name, `onMessage: found ${candidates.length} conflict candidates`);
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

      for (const candidate of candidates) {
        if (this.savedThisTurn.has(candidate.id)) continue;
        const mem = await this.db.getMemoryById(candidate.id);
        if (!mem) continue;
        if (mem.timestamp >= twoHoursAgo) {
          logger.info(this.name, `Deleting recent conflicting memory id=${candidate.id.slice(0, 8)}`);
          await this.db.deleteMemory(candidate.id);
        } else {
          logger.info(this.name, `Marking memory superseded id=${candidate.id.slice(0, 8)}`);
          const superseded = `[SUPERSEDED] User has since changed this position: ${mem.text}`;
          await this.db.updateMemoryText(candidate.id, superseded);
        }
      }
    } catch (e) {
      logger.error(this.name, "Autonomous memory management error:", e);
    }
  }
}
