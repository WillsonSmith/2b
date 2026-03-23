import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { CortexMemoryPlugin } from "./CortexMemoryPlugin.ts";
import { logger } from "../logger.ts";

export class ThoughtPlugin implements AgentPlugin {
  name = "ThoughtPlugin";
  private memoryPlugin: CortexMemoryPlugin;

  constructor(memoryPlugin: CortexMemoryPlugin) {
    this.memoryPlugin = memoryPlugin;
  }

  onInit(agent: BaseAgent): void {
    agent.on("thought", async (thought: string) => {
      if (!thought?.trim()) return;
      logger.debug("ThoughtPlugin", `Storing thought (${thought.length} chars)`);
      try {
        const text = `[THOUGHT] ${new Date().toISOString()}: ${thought}`;
        await this.memoryPlugin.db.addMemory(text, "thought");
        logger.debug("ThoughtPlugin", "Thought stored successfully");
      } catch (e) {
        logger.error("ThoughtPlugin", "Failed to store thought:", e);
      }
    });
  }

  getSystemPromptFragment(): string {
    return [
      "## Internal Thoughts",
      "Your <think> blocks are your private internal reasoning. These thoughts are stored as memory.",
      "Use your thoughts to drive proactive actions — don't just react to users, anticipate needs.",
      "Thoughts stored in memory can be retrieved with `get_recent_thoughts` or `search_memory`.",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "get_recent_thoughts",
        description: "Retrieve the N most recent internal thoughts.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "number",
              description: "Number of recent thoughts to retrieve (default 5)",
            },
          },
          required: [],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    try {
      if (name === "get_recent_thoughts") {
        const limit = args.limit ?? 5;
        const recent = this.memoryPlugin.db.getRecentMemories(limit, "thought");
        if (recent.length === 0) return "No recent thoughts found.";
        return recent.map((t) => t.text).join("\n");
      }
    } catch (e) {
      logger.error("ThoughtPlugin", `Tool error (${name}):`, e);
    }
  }
}
