import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { AgentPlugin, ToolDefinition } from "./Plugin.ts";
import type { Message } from "./types.ts";
import { logger } from "../logger.ts";

/**
 * A stateless, single-call agent with no tick loop or input sources.
 * Each ask() call is independent — no conversation history is maintained.
 * Plugins that rely on onMessage, getMessages, or augmentResponse are not invoked.
 */
export class HeadlessAgent {
  private toolCallHandler?: (name: string, args: any) => void;

  constructor(
    private readonly llm: LLMProvider,
    private readonly plugins: AgentPlugin[],
    private readonly systemPromptBase: string,
  ) {}

  setToolCallHandler(fn: (name: string, args: any) => void): void {
    this.toolCallHandler = fn;
  }

  async ask(task: string): Promise<string> {
    // Collect system prompt fragments
    const fragments: string[] = [];
    for (const plugin of this.plugins) {
      const fragment = plugin.getSystemPromptFragment?.();
      if (fragment) fragments.push(fragment);
    }

    // Collect dynamic context
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
    const systemPrompt = parts.filter(Boolean).join("\n\n");

    // Collect tools, wiring executeTool as implementation fallback
    const tools: ToolDefinition[] = [];
    for (const plugin of this.plugins) {
      if (plugin.getTools) {
        const pluginTools = plugin.getTools();
        for (const t of pluginTools) {
          if (!t.implementation && plugin.executeTool) {
            const toolName = t.name;
            t.implementation = (args) => {
              this.toolCallHandler?.(toolName, args);
              return plugin.executeTool!(toolName, args);
            };
          }
        }
        tools.push(...pluginTools);
      }
    }

    const messages: Message[] = [{ role: "user", content: task }];
    logger.info("HeadlessAgent", `ask() — tools=[${tools.map((t) => t.name).join(", ")}]`);

    const { nonReasoningContent } = await this.llm.chat(
      messages,
      systemPrompt,
      undefined,
      tools,
      undefined,
    );

    return nonReasoningContent;
  }
}
