import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { CortexMemoryPlugin } from "./CortexMemoryPlugin.ts";
import { logger } from "../logger.ts";

const PERMITTED_TYPES = new Set(["factual", "procedure"]);

/**
 * Registered on cortex sub-agents created by DynamicAgentPlugin when a parent
 * CortexMemoryPlugin is provided. Exposes a single tool that lets the sub-agent
 * persist important findings to the parent agent's long-term memory.
 *
 * Only 'factual' and 'procedure' types are permitted — sub-agents cannot write
 * behavior or thought memories to the parent.
 */
export class ParentMemoryBridgePlugin implements AgentPlugin {
  name = "ParentMemoryBridge";

  constructor(
    private readonly parentMemory: CortexMemoryPlugin,
    private readonly agentName: string,
  ) {}

  getSystemPromptFragment(): string {
    return [
      "## Parent Memory Bridge",
      "Use write_to_parent_memory to persist important facts or procedures discovered during this task to the orchestrating agent's long-term memory.",
      "Only use it for findings worth retaining across sessions. Do not use it for task-specific working notes.",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "write_to_parent_memory",
        description:
          "Persist an important fact or procedure to the parent agent's long-term memory. Findings written here will be available to the parent agent in future sessions.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The memory content to persist",
            },
            type: {
              type: "string",
              enum: ["factual", "procedure"],
              description: "Memory type. Only factual and procedure are permitted.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Optional tags",
            },
          },
          required: ["content", "type"],
          additionalProperties: false,
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name !== "write_to_parent_memory") return undefined;

    if (!args.type || !PERMITTED_TYPES.has(args.type)) {
      return "write_to_parent_memory error: type must be 'factual' or 'procedure'. Behavior and thought types cannot be written from sub-agents.";
    }

    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!content) {
      return "write_to_parent_memory error: content is required and must be a non-empty string.";
    }

    logger.info(
      "ParentMemoryBridge",
      `Sub-agent "${this.agentName}" writing ${args.type} memory to parent: "${content.slice(0, 80)}"`,
    );

    await this.parentMemory.writeMemory(
      content,
      args.type as "factual" | "procedure",
      Array.isArray(args.tags) ? args.tags : [],
      this.agentName,
    );

    return `Memory written to parent agent (type: ${args.type}).`;
  }
}
