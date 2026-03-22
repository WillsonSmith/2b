import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import { CortexMemoryDatabase, type MemoryFilter } from "./CortexMemoryDatabase.ts";
import { logger } from "../logger.ts";

export class CortexMemoryPlugin implements AgentPlugin {
  name = "CortexMemory";
  public db: CortexMemoryDatabase;
  private currentEvents: string[] = [];
  private savedThisTurn: Set<string> = new Set();

  constructor(llmProvider: any, name: string, dbPath?: string) {
    this.db = new CortexMemoryDatabase(llmProvider, name, dbPath);
  }

  onInit(_agent: BaseAgent): void {
    // Nothing to subscribe to at init; ThoughtPlugin will call db.addMemory directly
  }

  getSystemPromptFragment(): string {
    const parts = [
      "## Memory System",
      "You have a long-term memory system with three types of memories:",
      "- **factual**: specific details from conversations, decisions, established facts.",
      "- **thought**: your internal reasoning and reflections (written by your thought system).",
      "- **behavior**: learned preferences and behavioral rules (injected as active instructions).",
      "Use `search_memory` before making assertions about past conversations.",
      "Use `save_memory` to preserve important facts or decisions.",
      "Use `save_behavior` to record a persistent behavioral rule you want to follow on every future turn.",
      "Use `delete_memory` to remove a memory by its ID.",
      "Use `get_linked_memories` to follow chains of related ideas.",
      "Use `query_memories` to filter memories by type, tags, date range, or full-text content.",
      "Use `hybrid_search` to combine semantic similarity search with metadata filters.",
      "Use `aggregate_memories` to understand the shape and distribution of your memories.",
      "Use `get_memory_timeline` to retrieve memories in chronological order.",
    ];

    const behaviors = this.db.getRecentMemories(1000, "behavior");
    if (behaviors.length > 0) {
      parts.push("\n## Learned Behaviors");
      for (const b of behaviors) {
        parts.push(`- ${b.text}`);
      }
    }

    return parts.join("\n");
  }

  async getContext(currentEvents?: string[]): Promise<string> {
    try {
      this.currentEvents = currentEvents ?? [];
      this.savedThisTurn.clear();
      const query = currentEvents?.join(" ") ?? "";
      if (!query.trim()) return "";

      logger.debug("CortexMemory", `getContext() searching: "${query.slice(0, 80)}…"`);
      const results = await this.db.search(query, 3, 0.5, ["factual", "thought"]);
      logger.debug("CortexMemory", `getContext() found ${results.length} memories`);
      if (results.length === 0) return "";

      const entries = results.map((r) => `- [${r.id.slice(0, 8)}] ${r.text}`).join("\n");
      return `Relevant memories:\n${entries}`;
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
              enum: ["factual", "thought", "behavior"],
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
              enum: ["factual", "thought", "behavior"],
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
              items: { type: "string", enum: ["factual", "thought", "behavior"] },
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
              items: { type: "string", enum: ["factual", "thought", "behavior"] },
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
      if (name === "search_memory") {
        logger.info("CortexMemory", `search_memory: "${args.query}"${args.type ? ` type=${args.type}` : ""}`);
        const results = await this.db.search(args.query, 5, 0.4, args.type);
        logger.debug("CortexMemory", `search_memory found ${results.length} results`);
        if (results.length === 0) return "No relevant memories found.";
        const MAX_TEXT = 300;
        return results
          .map((r) => {
            const text =
              r.text.length > MAX_TEXT ? r.text.slice(0, MAX_TEXT) + "…" : r.text;
            return `[${r.id.slice(0, 8)}] (score: ${r.score.toFixed(2)}) ${text}`;
          })
          .join("\n");
      }

      if (name === "save_memory") {
        logger.info("CortexMemory", `save_memory type=${args.type ?? "factual"}: "${String(args.content).slice(0, 100)}"`);
        const id = await this.db.addMemory(args.content, args.type ?? "factual", args.tags ?? []);
        this.savedThisTurn.add(id);
        logger.info("CortexMemory", `save_memory SUCCESS id=${id.slice(0, 8)}`);
        // Link to top 3 similar existing memories
        const similar = await this.db.search(args.content, 3, 0.5);
        logger.debug("CortexMemory", `save_memory linking to ${similar.filter((s) => s.id !== id).length} similar memories`);
        for (const s of similar) {
          if (s.id !== id) await this.db.linkMemories(id, s.id);
        }
        return `Memory saved (id: ${id.slice(0, 8)}).`;
      }

      if (name === "save_behavior") {
        logger.info("CortexMemory", `save_behavior: "${String(args.rule).slice(0, 100)}"`);
        const id = await this.db.addMemory(args.rule, "behavior");
        return `Behavior rule saved (id: ${id.slice(0, 8)}).`;
      }

      if (name === "delete_memory") {
        logger.info("CortexMemory", `delete_memory id=${args.id.slice(0, 8)}`);
        await this.db.deleteMemory(args.id);
        return `Memory ${args.id.slice(0, 8)} deleted.`;
      }

      if (name === "get_linked_memories") {
        logger.debug("CortexMemory", `get_linked_memories id=${args.id.slice(0, 8)}`);
        const linked = await this.db.getLinkedMemories(args.id);
        logger.debug("CortexMemory", `get_linked_memories found ${linked.length} links`);
        if (linked.length === 0) return "No linked memories found.";
        return linked.map((m) => `[${m.id.slice(0, 8)}] ${m.text}`).join("\n");
      }

      if (name === "query_memories") {
        logger.info("CortexMemory", `query_memories: ${JSON.stringify(args)}`);
        const filter: MemoryFilter = {
          types: args.types,
          tags: args.tags,
          after: args.after,
          before: args.before,
          contains: args.contains,
          limit: args.limit,
        };
        const results = this.db.queryMemories(filter);
        logger.debug("CortexMemory", `query_memories found ${results.length} results`);
        if (results.length === 0) return "No memories match the given filter.";
        const MAX_TEXT = 300;
        return results
          .map((r) => {
            const text = r.text.length > MAX_TEXT ? r.text.slice(0, MAX_TEXT) + "…" : r.text;
            const tagsStr = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
            const date = new Date(r.timestamp).toISOString().slice(0, 10);
            return `[${r.id.slice(0, 8)}] (${r.type}, ${date}${tagsStr}) ${text}`;
          })
          .join("\n");
      }

      if (name === "hybrid_search") {
        logger.info("CortexMemory", `hybrid_search: "${args.query}"`);
        const filter: MemoryFilter = {
          types: args.types,
          tags: args.tags,
          after: args.after,
          before: args.before,
          contains: args.contains,
        };
        const results = await this.db.hybridSearch(args.query, filter, args.limit ?? 5, 0.4);
        logger.debug("CortexMemory", `hybrid_search found ${results.length} results`);
        if (results.length === 0) return "No memories match the given query and filters.";
        const MAX_TEXT = 300;
        return results
          .map((r) => {
            const text = r.text.length > MAX_TEXT ? r.text.slice(0, MAX_TEXT) + "…" : r.text;
            const tagsStr = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
            const date = new Date(r.timestamp).toISOString().slice(0, 10);
            return `[${r.id.slice(0, 8)}] (score: ${r.score.toFixed(2)}, ${r.type}, ${date}${tagsStr}) ${text}`;
          })
          .join("\n");
      }

      if (name === "aggregate_memories") {
        logger.info("CortexMemory", `aggregate_memories group_by=${args.group_by}`);
        const filter: MemoryFilter | undefined = args.filter
          ? {
              types: args.filter.types,
              tags: args.filter.tags,
              after: args.filter.after,
              before: args.filter.before,
              contains: args.filter.contains,
              limit: args.filter.limit,
            }
          : undefined;
        const results = this.db.aggregateMemories(args.group_by, filter);
        logger.debug("CortexMemory", `aggregate_memories found ${results.length} groups`);
        if (results.length === 0) return "No memories found.";
        const header = `${"Group".padEnd(30)} Count`;
        const divider = "-".repeat(36);
        const rows = results.map((r) => `${r.group.padEnd(30)} ${r.count}`);
        return [header, divider, ...rows].join("\n");
      }

      if (name === "get_memory_timeline") {
        logger.info("CortexMemory", `get_memory_timeline start=${args.start} end=${args.end}`);
        const start = args.start ? new Date(args.start).getTime() : undefined;
        const end = args.end ? new Date(args.end).getTime() : undefined;
        const results = this.db.getMemoryTimeline(start, end, args.limit ?? 20);
        logger.debug("CortexMemory", `get_memory_timeline found ${results.length} memories`);
        if (results.length === 0) return "No memories found in the given time range.";
        const MAX_TEXT = 300;
        return results
          .map((r) => {
            const text = r.text.length > MAX_TEXT ? r.text.slice(0, MAX_TEXT) + "…" : r.text;
            const tagsStr = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
            const date = new Date(r.timestamp).toISOString().replace("T", " ").slice(0, 19);
            return `[${r.id.slice(0, 8)}] (${r.type}, ${date}${tagsStr}) ${text}`;
          })
          .join("\n");
      }
    } catch (e) {
      logger.error("CortexMemory", `Tool error (${name}):`, e);
    }
  }

  async onMessage(
    role: "user" | "assistant" | "system",
    content: string,
    _source: string,
  ): Promise<void> {
    if (role !== "assistant") return;
    // Autonomous conflict resolution
    try {
      const conflictQuery = this.currentEvents.join(" ") + " " + content;
      logger.debug("CortexMemory", "onMessage: running autonomous conflict resolution");
      const candidates = await this.db.search(conflictQuery, 5, 0.85);
      logger.debug("CortexMemory", `onMessage: found ${candidates.length} conflict candidates`);
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;

      for (const candidate of candidates) {
        if (this.savedThisTurn.has(candidate.id)) continue;
        const mem = await this.db.getMemoryById(candidate.id);
        if (!mem) continue;
        if (mem.timestamp >= twoHoursAgo) {
          logger.info("CortexMemory", `Deleting recent conflicting memory id=${candidate.id.slice(0, 8)}`);
          await this.db.deleteMemory(candidate.id);
        } else {
          logger.info("CortexMemory", `Marking memory superseded id=${candidate.id.slice(0, 8)}`);
          const superseded = `[SUPERSEDED] User has since changed this position: ${mem.text}`;
          await this.db.updateMemoryText(candidate.id, superseded);
        }
      }
    } catch (e) {
      logger.error("CortexMemory", "Autonomous memory management error:", e);
    }
  }
}
