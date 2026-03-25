import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { CortexMemoryPlugin } from "./CortexMemoryPlugin.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import { logger } from "../logger.ts";

const SYNTHESIS_PROMPT = `You analyze internal AI reasoning and extract personality-shaping insights.

Given this internal thought, determine whether it contains a personal preference, value, communication style, or behavioral insight that should shape how the AI behaves in future conversations.

Qualifying examples: preferences about tone, honesty, depth of answers, how to handle conflict, what topics interest the AI, values the AI holds.
Non-qualifying examples: task-specific reasoning, working memory, step-by-step problem solving, observations about the current conversation.

If the thought contains a qualifying insight: reply with a single concise behavioral rule written in first person starting with "I " (e.g., "I prefer direct answers over lengthy explanations").
If it does not: reply with exactly the word SKIP and nothing else.`;

export class ThoughtPlugin implements AgentPlugin {
  name = "ThoughtPlugin";
  private memoryPlugin: CortexMemoryPlugin;
  private synthesisProvider: LLMProvider | null;

  constructor(memoryPlugin: CortexMemoryPlugin, synthesisProvider: LLMProvider | null = null) {
    this.memoryPlugin = memoryPlugin;
    this.synthesisProvider = synthesisProvider;
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

      // Fire-and-forget: synthesize behavioral insight without blocking
      if (this.synthesisProvider) {
        this.synthesizeAndStore(thought).catch((e) =>
          logger.error("ThoughtPlugin", "Synthesis failed:", e),
        );
      }
    });
  }

  private async synthesizeAndStore(thought: string): Promise<void> {
    const insight = await this.synthesizeThought(thought);
    if (!insight) return;

    // Deduplicate: skip if an identical behavior rule is already stored
    const existing = this.memoryPlugin.db.getRecentMemories(100, "behavior");
    if (existing.some((m) => m.text === insight)) {
      logger.debug("ThoughtPlugin", `Behavior insight already stored, skipping: "${insight}"`);
      return;
    }

    logger.debug("ThoughtPlugin", `Storing behavior insight: "${insight}"`);
    await this.memoryPlugin.db.addMemory(insight, "behavior");
  }

  private async synthesizeThought(thought: string): Promise<string | null> {
    if (!this.synthesisProvider) return null;
    try {
      const truncated = thought.slice(0, 1000);
      const { nonReasoningContent } = await this.synthesisProvider.chat(
        [{ role: "user", content: truncated }],
        SYNTHESIS_PROMPT,
      );
      const reply = nonReasoningContent.trim();
      if (!reply || reply.toUpperCase() === "SKIP") return null;
      if (!reply.startsWith("I ")) return null;
      return reply;
    } catch (e) {
      logger.debug("ThoughtPlugin", "Synthesis request failed:", e);
      return null;
    }
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
