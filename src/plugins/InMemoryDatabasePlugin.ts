import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";

/**
 * A simple in-memory key-value store that persists for the lifetime of the plugin instance.
 * Intended for use with dynamically-created HeadlessAgents so they can accumulate state
 * across multiple ask() calls within a session.
 */
export class InMemoryDatabasePlugin implements AgentPlugin {
  name = "InMemoryDatabase";
  private readonly store = new Map<string, string>();

  getSystemPromptFragment(): string {
    return [
      "You have a persistent in-memory key-value store for this session:",
      "- agent_memory_set(key, value): Store a string value under a key.",
      "- agent_memory_get(key): Retrieve a stored value.",
      "- agent_memory_delete(key): Remove a key.",
      "- agent_memory_list(): List all stored keys.",
      "Use this to track state, accumulate results, or remember facts across multiple calls.",
    ].join("\n");
  }

  getContext(): string {
    if (this.store.size === 0) return "";
    const keys = Array.from(this.store.keys()).join(", ");
    return `In-memory store has ${this.store.size} key(s): ${keys}`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "agent_memory_set",
        description:
          "Store a string value under a key in this agent's in-memory database. Overwrites if key already exists.",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "The key to store under." },
            value: { type: "string", description: "The string value to store." },
          },
          required: ["key", "value"],
        },
      },
      {
        name: "agent_memory_get",
        description: "Retrieve a value from this agent's in-memory database by key.",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "The key to look up." },
          },
          required: ["key"],
        },
      },
      {
        name: "agent_memory_delete",
        description: "Delete a key from this agent's in-memory database.",
        parameters: {
          type: "object",
          properties: {
            key: { type: "string", description: "The key to delete." },
          },
          required: ["key"],
        },
      },
      {
        name: "agent_memory_list",
        description: "List all keys currently stored in this agent's in-memory database.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ];
  }

  executeTool(name: string, args: Record<string, unknown>): unknown {
    switch (name) {
      case "agent_memory_set": {
        const key = args.key as string;
        const value = args.value as string;
        this.store.set(key, value);
        return { stored: key };
      }
      case "agent_memory_get": {
        const key = args.key as string;
        if (!this.store.has(key)) return { error: `Key "${key}" not found.` };
        return { key, value: this.store.get(key) };
      }
      case "agent_memory_delete": {
        const key = args.key as string;
        const existed = this.store.delete(key);
        return { deleted: key, existed };
      }
      case "agent_memory_list": {
        return { keys: Array.from(this.store.keys()) };
      }
      default:
        return undefined;
    }
  }
}
