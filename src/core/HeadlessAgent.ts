import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { AgentPlugin, ToolDefinition } from "./Plugin.ts";
import type { Message } from "./types.ts";
import { logger } from "../logger.ts";

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
  private toolCallHandler?: (event: "start" | "end", name: string, args: Record<string, unknown>) => void;

  constructor(
    private readonly llm: LLMProvider,
    private readonly plugins: AgentPlugin[],
    private readonly systemPromptBase: string,
  ) {}

  setToolCallHandler(fn: (event: "start" | "end", name: string, args: Record<string, unknown>) => void): void {
    this.toolCallHandler = fn;
  }

  async ask(task: string): Promise<string> {
    // Collect system prompt fragments and tools in a single pass
    const fragments: string[] = [];
    const tools: ToolDefinition[] = [];
    for (const plugin of this.plugins) {
      const fragment = plugin.getSystemPromptFragment?.();
      if (fragment) fragments.push(fragment);

      if (plugin.getTools) {
        const pluginTools = plugin.getTools();
        for (const rawTool of pluginTools) {
          const t: ToolDefinition = { ...rawTool };
          if (!t.implementation && plugin.executeTool) {
            const toolName = t.name;
            t.implementation = async (args) => {
              this.toolCallHandler?.("start", toolName, args as Record<string, unknown>);
              const result = await plugin.executeTool!(toolName, args as Record<string, unknown>);
              this.toolCallHandler?.("end", toolName, args as Record<string, unknown>);
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
    logger.info("HeadlessAgent", `ask() — tools=[${tools.map((t) => t.name).join(", ")}]`);

    const { nonReasoningContent } = await this.llm.chat(messages, systemPrompt, undefined, tools);

    return nonReasoningContent;
  }
}
