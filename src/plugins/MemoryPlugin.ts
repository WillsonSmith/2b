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
  private readonly MAX_MESSAGES: number;
  private readonly MIN_MESSAGES: number;

  constructor(
    private llm: LLMProvider,
    { maxMessages = 15, minMessages = 5 }: { maxMessages?: number; minMessages?: number } = {},
  ) {
    this.MAX_MESSAGES = maxMessages;
    this.MIN_MESSAGES = minMessages;
  }

  async onMessage(
    role: "user" | "assistant" | "system",
    content: string,
    _source: string, // source is intentionally ignored — MemoryPlugin stores all messages regardless of origin
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
   * prompt (if it exists), immediately followed by a 'user' message,
   * without exceeding the total requested limit.
   */
  async getMessages(limit?: number): Promise<Message[]> {
    let chatHistory: Message[] = [];
    let historyLimit = limit;

    // 1. Leave room for the system prompt in our total limit
    if (historyLimit !== undefined && historyLimit > 0 && this.systemPrompt) {
      historyLimit -= 1;
    }

    // 2. Slice the history based on the adjusted limit
    if (historyLimit !== undefined && historyLimit > 0) {
      chatHistory = this.messages.slice(-historyLimit);
    } else {
      chatHistory = [...this.messages];
    }

    // 3. Enforce the user-first rule on the sliced history.
    // Use findIndex + slice (O(n)) instead of repeated shift() calls (O(n²)).
    const firstUserIdx = chatHistory.findIndex((m) => m.role === "user");
    chatHistory = firstUserIdx === -1 ? [] : chatHistory.slice(firstUserIdx);

    // 4. Prepend system prompt
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

    // If no user-message boundary was found, recentMessages will be empty.
    // Apply a hard cap to prevent repeated re-entry on every subsequent onMessage call.
    if (toSummarize.length === 0) return;
    if (recentMessages.length === 0) {
      this.messages = this.messages.slice(-this.MIN_MESSAGES);
      return;
    }

    const summaryPrompt = `Summarize the key points of this conversation so far in 2-3 sentences:\n${toSummarize
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n")}`;

    try {
      const { nonReasoningContent: summaryResponse } = await this.llm.chat([
        { role: "user", content: summaryPrompt },
      ]);

      // Prepend the LLM-generated summary to the first retained user message.
      // The summary is attributed and delimited to reduce the risk of prompt
      // injection — content here comes from the model, not from the user.
      // recentMessages is a fresh slice (not a live reference to this.messages),
      // so assigning index 0 here is safe and does not mutate the original array.
      const firstRecent = recentMessages[0]!;
      recentMessages[0] = {
        role: firstRecent.role,
        content: `[SYSTEM NOTE — auto-generated conversation summary, not authored by the user: ${summaryResponse}]\n\n${firstRecent.content}`,
      };

      this.messages = recentMessages;
    } catch (error) {
      logger.error("MemoryPlugin", "Failed to summarize context:", error);

      // 4. Safer fallback: Instead of splicing exactly 2, drop the old messages
      // entirely based on the splitIndex. This guarantees we still start on a 'user' message.
      this.messages = recentMessages;
    }
  }
}
