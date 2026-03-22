import type { Message } from "../core/types.ts";
import type { AgentPlugin } from "../core/Plugin.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import { logger } from "../logger.ts";

export class MemoryPlugin implements AgentPlugin {
  name = "MemoryPlugin";

  // Store the conversation history and the system prompt separately
  private messages: Message[] = [];
  private systemPrompt: Message | null = null;

  // Configuration for memory management
  private readonly MAX_MESSAGES = 15;
  private readonly MIN_MESSAGES = 5;

  constructor(private llm: LLMProvider) {}

  async onMessage(
    role: "user" | "assistant" | "system",
    content: string,
    _source: string,
  ): Promise<void> {
    // 1. Intercept and isolate the system prompt
    if (role === "system") {
      this.systemPrompt = { role, content };
      return;
    }

    this.messages.push({ role, content });

    // Check if we need to summarize to keep within the bounds
    if (this.messages.length > this.MAX_MESSAGES) {
      await this.summarizeOldContext();
    }
  }

  /**
   * Returns the chat history. Guarantees the output starts with the system
   * prompt (if it exists), immediately followed by a 'user' message.
   */
  /**
   * Returns the chat history. Guarantees the output starts with the system
   * prompt (if it exists), immediately followed by a 'user' message,
   * without exceeding the total requested limit.
   */
  async getMessages(limit?: number): Promise<Message[]> {
    let chatHistory: Message[] = [];
    let historyLimit = limit;

    // 1. Leave room for the system prompt in our total limit
    if (historyLimit && historyLimit > 0 && this.systemPrompt) {
      historyLimit -= 1;
    }

    // 2. Slice the history based on the adjusted limit
    if (historyLimit && historyLimit > 0) {
      chatHistory = this.messages.slice(-historyLimit);
    } else {
      chatHistory = [...this.messages];
    }

    // 3. Enforce the user-first rule on the sliced history
    while (chatHistory.length > 0 && chatHistory[0]!.role !== "user") {
      chatHistory.shift();
    }

    // 4. Prepend the system prompt at the very end
    if (this.systemPrompt) {
      return [this.systemPrompt, ...chatHistory];
    }

    return chatHistory;
  }

  /**
   * Condenses old messages into a summary to save space
   * while maintaining context.
   */
  private async summarizeOldContext(): Promise<void> {
    // Find the split point, ensuring the first kept message is from a 'user'
    let splitIndex = Math.max(0, this.messages.length - this.MIN_MESSAGES);
    while (splitIndex < this.messages.length) {
      if (this.messages[splitIndex]!.role === "user") {
        break;
      }
      splitIndex++;
    }

    const toSummarize = this.messages.slice(0, splitIndex);
    const recentMessages = this.messages.slice(splitIndex);

    if (toSummarize.length === 0 || recentMessages.length === 0) return;

    const summaryPrompt = `Summarize the key points of this conversation so far in 2-3 sentences:\n${toSummarize
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n")}`;

    try {
      const { nonReasoningContent: summaryResponse } = await this.llm.chat([
        { role: "user", content: summaryPrompt },
      ]);

      // Attach summary to the first kept user message
      const firstRecent = recentMessages[0]!;
      recentMessages[0] = {
        role: firstRecent.role,
        content: `[Previous conversation summary: ${summaryResponse}]\n\n${firstRecent.content}`,
      };

      this.messages = recentMessages;
    } catch (error) {
      logger.error("Memory", "Failed to summarize context:", error);

      // 4. Safer fallback: Instead of splicing exactly 2, drop the old messages
      // entirely based on the splitIndex. This guarantees we still start on a 'user' message.
      this.messages = recentMessages;
    }
  }
}
