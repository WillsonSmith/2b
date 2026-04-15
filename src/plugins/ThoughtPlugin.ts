import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import { logger } from "../logger.ts";

const MAX_SYNTHESIS_CHARS = 1000;
const MAX_INSIGHT_LENGTH = 200;
const MAX_RECENT_THOUGHTS = 20;

export class ThoughtPlugin implements AgentPlugin {
  name = "Thought";
  private agent: BaseAgent | null = null;
  private synthesisProvider: LLMProvider | null;
  private listenerRegistered = false;
  private recentThoughts: Array<{ text: string; timestamp: number }> = [];

  protected synthesisPrompt = `You analyze internal AI reasoning and extract personality-shaping insights.

Given this internal thought, determine whether it contains a personal preference, value, communication style, or behavioral insight that should shape how the AI behaves in future conversations.

Qualifying examples: preferences about tone, honesty, depth of answers, how to handle conflict, what topics interest the AI, values the AI holds.
Non-qualifying examples: task-specific reasoning, working memory, step-by-step problem solving, observations about the current conversation.

If the thought contains a qualifying insight: reply with a single concise behavioral rule written in first person starting with "I " (e.g., "I prefer direct answers over lengthy explanations").
If it does not: reply with exactly the word SKIP and nothing else.`;

  constructor(synthesisProvider: LLMProvider | null = null) {
    this.synthesisProvider = synthesisProvider;
  }

  onInit(agent: BaseAgent): void {
    if (this.listenerRegistered) return;
    this.listenerRegistered = true;
    this.agent = agent;

    agent.on("thought", async (thought: string) => {
      if (!thought?.trim()) return;
      const trimmed = thought.trim();
      logger.debug("ThoughtPlugin", `Storing thought (${trimmed.length} chars)`);

      // Push to local ring buffer for get_recent_thoughts tool
      this.recentThoughts.push({ text: trimmed, timestamp: Date.now() });
      if (this.recentThoughts.length > MAX_RECENT_THOUGHTS) {
        this.recentThoughts.shift();
      }

      // Emit to event bus — CortexMemoryPlugin will persist if registered
      this.agent?.requestMemoryWrite({
        text: trimmed,
        type: "thought",
        tags: [],
        source: "thought-plugin",
      });

      // Fire-and-forget: synthesize behavioral insight without blocking
      if (this.synthesisProvider) {
        this.synthesizeAndStore(trimmed).catch(e =>
          logger.error("ThoughtPlugin", "Synthesis failed:", e),
        );
      }
    });
  }

  private async synthesizeAndStore(thought: string): Promise<void> {
    const insight = await this.synthesizeThought(thought);
    if (!insight) return;

    logger.debug("ThoughtPlugin", `Emitting behavior insight: "${insight}"`);
    this.agent?.requestMemoryWrite({
      text: insight,
      type: "behavior",
      tags: [],
      source: "thought-plugin",
    });
  }

  private async synthesizeThought(thought: string): Promise<string | null> {
    if (!this.synthesisProvider) return null;
    try {
      const truncated = thought.slice(0, MAX_SYNTHESIS_CHARS);
      // nonReasoningContent is used intentionally; reasoning/scratchpad output is discarded
      const { nonReasoningContent } = await this.synthesisProvider.chat(
        [{ role: "user", content: truncated }],
        this.synthesisPrompt,
      );
      const reply = nonReasoningContent.trim();
      if (!reply || reply.toUpperCase() === "SKIP") return null;
      if (!reply.startsWith("I ")) return null;
      if (reply.length > MAX_INSIGHT_LENGTH) return null;
      return reply;
    } catch (e) {
      logger.debug("ThoughtPlugin", "Synthesis request failed:", e);
      return null;
    }
  }

  getSystemPromptFragment(): string {
    return [
      "## Internal Reasoning",
      "Your reasoning process is captured automatically and stored as memory each turn.",
      "Use `get_recent_thoughts` to review your recent reasoning, or `search_memory` to find older thoughts.",
      "Use your reasoning to drive proactive actions — don't just react to users, anticipate needs.",
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
        const recent = this.recentThoughts.slice(-limit);
        if (recent.length === 0) return "No recent thoughts found.";
        return recent
          .map(t => `[${new Date(t.timestamp).toISOString()}] ${t.text}`)
          .join("\n");
      }
    } catch (e) {
      logger.error("ThoughtPlugin", `Tool error (${name}):`, e);
      return { error: "Failed to retrieve thoughts." };
    }
    return undefined;
  }
}
