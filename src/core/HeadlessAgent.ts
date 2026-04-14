import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { AgentPlugin, ToolDefinition } from "./Plugin.ts";
import type { Message } from "./types.ts";
import { AutoDenyPermissionManager, type PermissionManager } from "./PermissionManager.ts";
import { logger } from "../logger.ts";

export interface HeadlessAgentOptions {
  /** Permission manager for tools that declare permission !== "none". If omitted, such tools are auto-denied. */
  permissionManager?: PermissionManager;
  /** Display name used in permission prompts. Defaults to "HeadlessAgent". */
  agentName?: string;
  /** Optional token streaming callback. Called for each token as the model produces it. */
  onToken?: (token: string, isReasoning: boolean) => void;
  /**
   * How many consecutive calls to the same tool are allowed before the agent is
   * forced to stop retrying and produce a final answer. Resets when the model
   * switches to a different tool. Defaults to 5.
   */
  maxConsecutiveToolCalls?: number;
}

/**
 * A stateless, single-call agent with no tick loop or input sources.
 * Each ask() call is independent — no conversation history is maintained.
 * Plugins that rely on onMessage, getMessages, or augmentResponse are not invoked.
 * onInit is also not called — plugins must be initialised before being passed in.
 *
 * Security note: plugin getContext() implementations must not echo back untrusted
 * task input verbatim, as context is injected into the system prompt.
 */
export class HeadlessAgent {
  private toolCallHandler?: (name: string, args: Record<string, unknown>) => void;
  private onToken?: (token: string, isReasoning: boolean) => void;
  private currentAbortController: AbortController | null = null;

  constructor(
    private readonly llm: LLMProvider,
    private readonly plugins: AgentPlugin[],
    private readonly systemPromptBase: string,
    private readonly options: HeadlessAgentOptions = {},
  ) {
    this.onToken = options.onToken;
  }

  /** Override the token callback at runtime (used by SubAgentPlugin to forward tokens as events). */
  setOnToken(fn: (token: string, isReasoning: boolean) => void): void {
    this.onToken = fn;
  }

  setToolCallHandler(fn: (name: string, args: Record<string, unknown>) => void): void {
    this.toolCallHandler = fn;
  }

  interrupt(): void {
    this.currentAbortController?.abort();
  }

  async ask(task: string): Promise<string> {
    const agentName = this.options.agentName ?? "HeadlessAgent";
    // Fix #2: resolve once per ask() rather than allocating inside each tool
    // implementation closure, which would create a new instance per tool call.
    const pm = this.options.permissionManager ?? new AutoDenyPermissionManager();

    // Consecutive-call circuit breaker: tracks how many times the same tool has
    // been called in a row. Resets to 0 whenever the model switches tools.
    const maxConsecutive = this.options.maxConsecutiveToolCalls ?? 5;
    let lastToolName = "";
    let consecutiveCount = 0;

    // Collect system prompt fragments and tools in a single pass
    const fragments: string[] = [];
    const tools: ToolDefinition[] = [];
    for (const plugin of this.plugins) {
      const fragment = plugin.getSystemPromptFragment
        ? await plugin.getSystemPromptFragment(task)
        : undefined;
      if (fragment) fragments.push(fragment);

      if (plugin.getTools) {
        const pluginTools = plugin.getTools();
        for (const rawTool of pluginTools) {
          const t: ToolDefinition = { ...rawTool };
          if (!t.implementation && plugin.executeTool) {
            const toolName = t.name;
            const permission = rawTool.permission ?? "none";
            t.implementation = async (args) => {
              if (permission !== "none") {
                const allowed = await pm.requestApproval({
                  agentName,
                  toolName,
                  args: args as Record<string, unknown>,
                });
                if (!allowed) return { error: "Permission denied by user." };
              }

              if (toolName === lastToolName) {
                consecutiveCount++;
              } else {
                lastToolName = toolName;
                consecutiveCount = 1;
              }

              if (consecutiveCount > maxConsecutive) {
                logger.warn(
                  "HeadlessAgent",
                  `[${agentName}] "${toolName}" called ${consecutiveCount} times consecutively — forcing stop.`,
                );
                return {
                  error: `You have called "${toolName}" ${consecutiveCount} times in a row without a successful result. Stop using this tool and provide your best answer based on what you already know.`,
                };
              }

              if (this.currentAbortController?.signal.aborted) {
                return { error: "Interrupted." };
              }
              this.toolCallHandler?.(toolName, args as Record<string, unknown>);
              const result = await plugin.executeTool!(toolName, args as Record<string, unknown>);
              return result;
            };
          }
          tools.push(t);
        }
      }
    }

    // Collect dynamic context (async — must remain a separate pass)
    let pluginContext = "";
    for (const plugin of this.plugins) {
      if (plugin.getContext) {
        try {
          const ctx = await plugin.getContext([task]);
          if (ctx) pluginContext += `\n${plugin.name}: ${ctx.trim()}`;
        } catch (e) {
          logger.error("HeadlessAgent", `Plugin error in ${plugin.name}:`, e);
        }
      }
    }

    // Build system prompt
    const parts = [this.systemPromptBase];
    if (pluginContext.trim()) parts.push(`Plugin Context:\n${pluginContext.trim()}`);
    if (fragments.length > 0) parts.push(fragments.join("\n"));
    const systemPrompt = parts.filter((p) => p.trim().length > 0).join("\n\n");

    const messages: Message[] = [{ role: "user", content: task }];
    logger.info("HeadlessAgent", `ask() [${agentName}] — tools=[${tools.map((t) => t.name).join(", ")}]`);

    this.currentAbortController = new AbortController();
    try {
      const { nonReasoningContent } = await this.llm.chat(messages, systemPrompt, undefined, tools, this.onToken, this.currentAbortController.signal);
      return nonReasoningContent;
    } finally {
      this.currentAbortController = null;
    }
  }
}
