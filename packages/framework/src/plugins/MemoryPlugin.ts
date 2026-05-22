/**
 * MemoryPlugin — short-term conversation history with a rolling summary.
 *
 * Stores the message history that BaseAgent replays on each LLM call. When the
 * history exceeds MAX_MESSAGES (default 15), it fires a background LLM pass
 * that integrates the oldest messages into a running narrative summary, then
 * trims the summarized prefix from the history. The summary is length-capped
 * (MAX_SUMMARY_CHARS) and carried across summarization cycles so context from
 * earlier in the conversation is gradually compressed rather than lost.
 *
 * The running summary is injected into `getMessages()` as its own system-role
 * entry, separate from the agent's main system message. It is NOT spliced into
 * any user message.
 *
 * This is distinct from CortexMemoryPlugin (long-term semantic memory). This
 * plugin manages the LLM's context window; CortexMemoryPlugin manages
 * persistent cross-session knowledge.
 *
 * Critical: every user and assistant message passes through `onMessage()`.
 * Breaking this interrupts the agent's ability to follow multi-turn conversations.
 *
 * Depends on:
 *   - LLMProvider — used for the background summarization and procedure extraction calls
 *   - BaseAgent.getLastSystemPrompt() — included in summarization so the LLM has context
 *   - BaseAgent.requestMemoryWrite() — to persist summaries and procedures to long-term memory
 */
import type { Message } from "../core/types.ts";
import type { AgentPlugin } from "../core/Plugin.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import { logger } from "../logger.ts";

/** @see module-level JSDoc above for full description. */
export class MemoryPlugin implements AgentPlugin {
  name = "MemoryPlugin";

  private messages: Message[] = [];
  private systemMessage: Message | null = null;
  private runningSummary: string = "";
  private agent: BaseAgent | null = null;
  private summarizing = false;

  private readonly MAX_MESSAGES: number;
  private readonly MIN_MESSAGES: number;
  private readonly MAX_SUMMARY_CHARS = 800;

  constructor(
    private llm: LLMProvider,
    {
      maxMessages = 15,
      minMessages = 5,
    }: { maxMessages?: number; minMessages?: number } = {},
  ) {
    this.MAX_MESSAGES = maxMessages;
    this.MIN_MESSAGES = minMessages;
  }

  onInit(agent: BaseAgent): void {
    this.agent = agent;
  }

  async onMessage(
    role: "user" | "assistant" | "system",
    content: string,
    _source: string,
  ): Promise<void> {
    if (role === "system") {
      this.systemMessage = { role: "system", content };
      return;
    }
    this.messages.push({ role, content });
    if (this.messages.length > this.MAX_MESSAGES && !this.summarizing) {
      this.summarizeOldContext().catch((e) =>
        logger.error("MemoryPlugin", "Background summarization failed:", e),
      );
    }
  }

  /**
   * Returns the chat history starting from the first user message.
   *
   * Prepended (in order, each consuming one slot against `limit`):
   *  1. The main system message, if `onMessage("system", ...)` was called.
   *  2. The running conversation summary, if non-empty, as its own system entry.
   *
   * `limit=0` and `limit=undefined` both mean "no limit" (consistent with the
   * prior behavior). When `limit` is positive, the prefix slots are subtracted
   * first; if no conversation slots remain, only the prefix is returned.
   */
  async getMessages(limit?: number): Promise<Message[]> {
    const hasSystem = this.systemMessage !== null;
    const hasSummary = this.runningSummary.length > 0;
    const slotsUsed = (hasSystem ? 1 : 0) + (hasSummary ? 1 : 0);

    let conversation: Message[];
    if (limit !== undefined && limit > 0) {
      const conversationLimit = Math.max(0, limit - slotsUsed);
      const sliced =
        conversationLimit === 0 ? [] : this.messages.slice(-conversationLimit);
      const firstUserIdx = sliced.findIndex((m) => m.role === "user");
      conversation = firstUserIdx === -1 ? [] : sliced.slice(firstUserIdx);
    } else {
      const firstUserIdx = this.messages.findIndex((m) => m.role === "user");
      conversation = firstUserIdx === -1 ? [] : this.messages.slice(firstUserIdx);
    }

    const prefix: Message[] = [];
    if (hasSystem) prefix.push(this.systemMessage!);
    if (hasSummary) {
      prefix.push({
        role: "system",
        content: `[Running conversation summary — auto-generated, not authored by the user]\n${this.runningSummary}`,
      });
    }

    return [...prefix, ...conversation];
  }

  /**
   * Pre-loads a slice of prior history so the agent has context on first turn.
   * Takes the last MIN_MESSAGES items from `messages`, advancing the start
   * until it lands on a `user` message (preserving the invariant that history
   * never begins with an assistant turn). Safe to call before `onInit`.
   */
  seed(messages: Array<{ role: "user" | "assistant"; content: string }>): void {
    const tail =
      messages.length > this.MIN_MESSAGES
        ? messages.slice(messages.length - this.MIN_MESSAGES)
        : [...messages];
    let firstUser = tail.findIndex((m) => m.role === "user");
    this.messages = firstUser === -1 ? [] : tail.slice(firstUser);
  }

  /** Resets short-term history. Call when switching sessions. */
  clear(): void {
    this.messages = [];
    this.systemMessage = null;
    this.runningSummary = "";
  }

  /**
   * Integrates the oldest messages into the running narrative summary and
   * trims them from the history.
   *
   * Race-safe: takes a slice for the LLM call, then splices the same prefix
   * length out of `this.messages` after the await. Any messages appended via
   * `onMessage` while the LLM call is in flight are preserved.
   *
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

      if (splitIndex === this.messages.length) {
        logger.warn(
          "MemoryPlugin",
          `No user message in recent tail of ${this.MIN_MESSAGES}; summarizing entire history.`,
        );
      }

      const summarizedCount = splitIndex;
      const toSummarize = this.messages.slice(0, summarizedCount);
      if (toSummarize.length === 0) return;

      const conversationText = toSummarize
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const summaryPrompt = `You are maintaining a running summary of an ongoing conversation. Update the existing summary by integrating the new messages below, then return the updated summary as plain prose. Compress older detail; preserve recent decisions, names, IDs, and any user preferences verbatim. The full output must be under ${this.MAX_SUMMARY_CHARS} characters.

EXISTING SUMMARY (may be empty):
${this.runningSummary || "(none)"}

NEW MESSAGES:
${conversationText}

UPDATED SUMMARY (under ${this.MAX_SUMMARY_CHARS} chars, plain prose):`;

      const systemPrompt = this.agent?.getLastSystemPrompt();
      const summaryMessages: Message[] = [];
      if (systemPrompt) summaryMessages.push({ role: "system", content: systemPrompt });
      summaryMessages.push({ role: "user", content: summaryPrompt });

      const { nonReasoningContent: summaryResponse } = await this.llm.chat(summaryMessages);

      const newSummary = summaryResponse?.trim() ?? "";
      if (!newSummary) {
        logger.warn(
          "MemoryPlugin",
          "Summarizer returned empty response; leaving history intact for retry on next trigger.",
        );
        return;
      }

      // Splice in place: anything appended during the await is preserved.
      this.messages.splice(0, summarizedCount);
      this.runningSummary = newSummary.slice(0, this.MAX_SUMMARY_CHARS);

      this.agent?.requestMemoryWrite({
        text: `[SESSION_SUMMARY ${new Date().toISOString()}]\n${this.runningSummary}`,
        type: "factual",
        tags: ["session_summary"],
        source: "MemoryPlugin",
      });

      this.extractProcedures(toSummarize, systemPrompt).catch((e) =>
        logger.error("MemoryPlugin", "Failed to extract procedures:", e),
      );

      this.extractBehaviors(toSummarize).catch((e) =>
        logger.error("MemoryPlugin", "Failed to extract behaviors:", e),
      );
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
    // Tool calls live in a separate field on the agent; this plugin only sees
    // prose. The regex catches assistant prose that explicitly names a tool —
    // a coarse but cheap gate for the extraction LLM call. Source of truth for
    // the tool list: getTools() in CortexMemoryPlugin, BehaviorPlugin,
    // ThoughtPlugin, MetacognitionPlugin (plus diagnostic dispatch in
    // CortexMemoryPlugin.executeTool).
    const hasToolActivity = messages.some((m) =>
      /\b(save_memory|hybrid_search|synthesize_memories|reflect_on_topic|save_behavior|synthesize_behaviors|get_recent_thoughts|introspect|memory_status|search_memory|edit_memory|delete_memory)\b/i.test(m.content),
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

    this.agent?.requestMemoryWrite({
      text: `[AUTO_EXTRACTED]\n${extractionResponse}`,
      type: "procedure",
      tags: ["auto_extracted"],
      source: "MemoryPlugin",
    });
    logger.info("MemoryPlugin", "Extracted procedure from summarized context");
  }

  /**
   * Scans the summarized message window for stated user preferences, corrections,
   * and recurring rules, then persists each distinct one as a behavior memory.
   * Runs fire-and-forget after summarization; dedup in writeMemory (0.92 threshold)
   * prevents near-identical behaviors from accumulating across summarization cycles.
   */
  private async extractBehaviors(messages: Message[]): Promise<void> {
    const hasPreferenceSignal = messages.some((m) =>
      m.role === "user" && /\b(prefer|always|never|stop|don't|avoid|please|instead|rather|want you to|should)\b/i.test(m.content),
    );
    if (!hasPreferenceSignal) return;

    const conversationText = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role}: ${m.content.slice(0, 500)}`)
      .join("\n");

    const extractionPrompt = `Review this conversation and extract any persistent behavioral rules for the AI assistant.

Look for:
- User corrections: "stop doing X", "don't X", "avoid Y"
- Stated preferences: "I prefer X", "always use Y", "I want you to Z"
- Workflow rules: "when doing X, always Y first"
- Style preferences: formatting, tone, naming conventions

Output each rule on its own line prefixed with "RULE:". Keep rules concise (under 120 chars).
If no behavioral rules are present, output: NONE

Conversation:
${conversationText}`;

    const { nonReasoningContent: response } = await this.llm.chat([
      { role: "user", content: extractionPrompt },
    ]);

    if (!response || response.trim() === "NONE") return;

    const rules = response
      .split("\n")
      .map((line) => line.replace(/^RULE:\s*/i, "").trim())
      .filter((line) => line.length > 5 && line.length <= 200);

    for (const rule of rules) {
      this.agent?.requestMemoryWrite({
        text: rule,
        type: "behavior",
        tags: ["auto_extracted"],
        source: "MemoryPlugin:auto",
      });
    }

    if (rules.length > 0) {
      logger.info("MemoryPlugin", `Extracted ${rules.length} behavior(s) from summarized context`);
    }
  }
}
