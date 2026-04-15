import type { Message } from "../core/types.ts";
import type { AgentPlugin } from "../core/Plugin.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { CortexMemoryPlugin } from "./CortexMemoryPlugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import { logger } from "../logger.ts";

export class MemoryPlugin implements AgentPlugin {
  name = "MemoryPlugin";

  private messages: Message[] = [];
  private agent: BaseAgent | null = null;
  private summarizing = false;

  private readonly MAX_MESSAGES: number;
  private readonly MIN_MESSAGES: number;
  private readonly cortexMemory: CortexMemoryPlugin | undefined;

  constructor(
    private llm: LLMProvider,
    {
      maxMessages = 15,
      minMessages = 5,
      cortexMemory,
    }: { maxMessages?: number; minMessages?: number; cortexMemory?: CortexMemoryPlugin } = {},
  ) {
    this.MAX_MESSAGES = maxMessages;
    this.MIN_MESSAGES = minMessages;
    this.cortexMemory = cortexMemory;
  }

  onInit(agent: BaseAgent): void {
    this.agent = agent;

    // Summarize after each turn completes, not during message ingestion.
    // This avoids blocking onMessage with an LLM round-trip and ensures
    // getLastSystemPrompt() reflects the fully assembled prompt for that turn.
    agent.on("state_change", (state) => {
      if (state === "idle" && this.messages.length > this.MAX_MESSAGES && !this.summarizing) {
        this.summarizeOldContext().catch((e) =>
          logger.error("MemoryPlugin", "Background summarization failed:", e),
        );
      }
    });
  }

  async onMessage(
    role: "user" | "assistant" | "system",
    content: string,
    _source: string,
  ): Promise<void> {
    if (role === "system") return; // BaseAgent handles the system prompt separately
    this.messages.push({ role, content });
  }

  /**
   * Returns the chat history starting from the first user message,
   * respecting the optional limit.
   */
  async getMessages(limit?: number): Promise<Message[]> {
    let chatHistory = limit !== undefined && limit > 0
      ? this.messages.slice(-limit)
      : [...this.messages];

    const firstUserIdx = chatHistory.findIndex((m) => m.role === "user");
    return firstUserIdx === -1 ? [] : chatHistory.slice(firstUserIdx);
  }

  /**
   * Condenses old messages into a structured summary and trims the history.
   * Runs after each turn (triggered via state_change → idle).
   * Uses the agent's last assembled system prompt so the summarizer has full
   * context about the agent's identity, tools, and learned behaviors.
   */
  private async summarizeOldContext(): Promise<void> {
    this.summarizing = true;

    try {
      // Find the split point, ensuring the first kept message is from a 'user'
      let splitIndex = Math.max(0, this.messages.length - this.MIN_MESSAGES);
      while (splitIndex < this.messages.length) {
        if (this.messages[splitIndex]!.role === "user") break;
        splitIndex++;
      }

      const toSummarize = this.messages.slice(0, splitIndex);
      const recentMessages = this.messages.slice(splitIndex);

      if (toSummarize.length === 0) return;
      if (recentMessages.length === 0) {
        this.messages = this.messages.slice(-this.MIN_MESSAGES);
        return;
      }

      const conversationText = toSummarize
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const summaryPrompt = `Analyze this conversation segment and respond with exactly these four labeled sections:

DECISIONS: Key decisions or conclusions reached (one per line, or "none")
TOOLS: Tools called and what they returned or revealed (one per line, or "none")
MEMORIES_SAVED: Facts or behaviors explicitly saved to long-term memory (one per line, or "none")
OPEN_QUESTIONS: Unresolved questions or uncertainties that carry forward (one per line, or "none")

Conversation:
${conversationText}`;

      const systemPrompt = this.agent?.getLastSystemPrompt();
      const summaryMessages: Message[] = [];
      if (systemPrompt) summaryMessages.push({ role: "system", content: systemPrompt });
      summaryMessages.push({ role: "user", content: summaryPrompt });

      const { nonReasoningContent: summaryResponse } = await this.llm.chat(summaryMessages);

      // Prepend the summary to the first retained user message.
      // Attributed and delimited to reduce prompt injection risk.
      const firstRecent = recentMessages[0]!;
      recentMessages[0] = {
        role: firstRecent.role,
        content: `[SYSTEM NOTE — auto-generated conversation summary, not authored by the user: ${summaryResponse}]\n\n${firstRecent.content}`,
      };

      this.messages = recentMessages;

      if (this.cortexMemory && summaryResponse) {
        this.cortexMemory.db
          .addMemory(
            `[SESSION_SUMMARY ${new Date().toISOString()}]\n${summaryResponse}`,
            "factual",
            ["session_summary"],
          )
          .catch((e) => logger.error("MemoryPlugin", "Failed to persist summary:", e));

        this.extractProcedures(toSummarize, systemPrompt).catch((e) =>
          logger.error("MemoryPlugin", "Failed to extract procedures:", e),
        );
      }
    } catch (error) {
      logger.error("MemoryPlugin", "Failed to summarize context:", error);
    } finally {
      this.summarizing = false;
    }
  }

  /**
   * Runs a second LLM pass over the summarized messages to extract tool-use
   * rationale and decision chains, then saves the result as a procedure memory.
   * Called fire-and-forget after summarization.
   */
  private async extractProcedures(messages: Message[], systemPrompt: string | undefined): Promise<void> {
    const hasToolActivity = messages.some((m) =>
      /\b(tool|search|save|search_memory|hybrid_search|save_memory|save_behavior)\b/i.test(m.content),
    );
    if (!hasToolActivity) return;

    const conversationText = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
    const extractionPrompt = `Review this conversation segment and extract any reusable procedures or decision chains.

If there are tool calls with clear goals and steps, output a procedure in this format:
GOAL: <short description of what was accomplished>
STEPS:
1. <step>
2. <step>
...

If there are no meaningful procedures to extract, output: NONE

Conversation:
${conversationText}`;

    const extractionMessages: Message[] = [];
    if (systemPrompt) extractionMessages.push({ role: "system", content: systemPrompt });
    extractionMessages.push({ role: "user", content: extractionPrompt });

    const { nonReasoningContent: extractionResponse } = await this.llm.chat(extractionMessages);

    if (!extractionResponse || extractionResponse.trim() === "NONE") return;

    await this.cortexMemory!.db.addMemory(
      `[AUTO_EXTRACTED]\n${extractionResponse}`,
      "procedure",
      ["auto_extracted"],
    );
    logger.info("MemoryPlugin", "Extracted procedure from summarized context");
  }
}
