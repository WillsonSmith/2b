import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import { CortexMemoryDatabase } from "./CortexMemoryDatabase.ts";
import { logger } from "../logger.ts";

export class CortexMemoryPlugin implements AgentPlugin {
  name = "CortexMemory";
  public db: CortexMemoryDatabase;
  private currentEvents: string[] = [];

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
    ];

    const behaviors = this.db.getRecentMemories(10, "behavior");
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
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    try {
      if (name === "search_memory") {
        logger.info("CortexMemory", `search_memory: "${args.query}"${args.type ? ` type=${args.type}` : ""}`);
        const results = await this.db.search(args.query, 5, 0.4, args.type);
        logger.debug("CortexMemory", `search_memory found ${results.length} results`);
        if (results.length === 0) return "No relevant memories found.";
        return results
          .map((r) => `[${r.id.slice(0, 8)}] (score: ${r.score.toFixed(2)}) ${r.text}`)
          .join("\n");
      }

      if (name === "save_memory") {
        logger.info("CortexMemory", `save_memory type=${args.type ?? "factual"}: "${String(args.content).slice(0, 100)}"`);
        const id = await this.db.addMemory(args.content, args.type ?? "factual");
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
