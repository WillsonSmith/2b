import { EventEmitter } from "node:events";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { AgentPlugin, ToolDefinition } from "./Plugin.ts";
import type { InputSource } from "./InputSource.ts";
import type { AgentConfig, Message } from "./types.ts";
import { logger } from "../logger.ts";

export class BaseAgent extends EventEmitter {
  private isThinking = false;
  private isPaused = false;
  private directQueue: string[] = [];
  private ambientQueue: string[] = [];
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private plugins: AgentPlugin[] = [];
  private inputSources: InputSource[] = [];
  private currentAbortController: AbortController | null = null;
  private readonly IGNORE_KEYWORD = "[IGNORE]";
  private tokenCallback: ((token: string, isReasoning: boolean) => void) | undefined = undefined;
  private proactiveTasks: Array<{ intervalMs: number; task: () => string | null; lastRun: number }> = [];
  private proactiveTimer: ReturnType<typeof setTimeout> | null = null;

  public get name(): string {
    return this.config.name ?? "Agent";
  }

  constructor(
    private llm: LLMProvider,
    private config: AgentConfig,
  ) {
    super();
  }

  public registerPlugin(plugin: AgentPlugin): this {
    this.plugins.push(plugin);
    return this;
  }

  public addInputSource(source: InputSource): this {
    this.inputSources.push(source);
    source.on("direct_input", (text: string) => this.addDirect(text));
    source.on("ambient_input", (text: string) => this.addAmbient(text));
    return this;
  }

  /** Queue input that requires a response and immediately schedule a tick. */
  public addDirect(text: string) {
    this.directQueue.push(text);
    this.tick();
  }

  /** Queue passive perception. The agent may choose to ignore it. */
  public addAmbient(text: string, opts: { forceTick?: boolean } = {}) {
    this.ambientQueue.push(text);
    if (opts.forceTick) this.tick();
  }

  /**
   * Backward-compatible shim used by existing plugins (e.g. AudioPlugin, CLIPlugin).
   * Routes [Heard] and [User said] prefixes to directQueue; everything else to ambientQueue.
   */
  public addPerception(text: string, opts: { forceTick?: boolean } = {}) {
    if (text.startsWith('[Heard "') || text.startsWith('[User said "')) {
      this.addDirect(text);
    } else {
      this.addAmbient(text, opts);
    }
  }

  /** Register a callback that receives each token as the LLM streams its response. */
  public setTokenCallback(fn: (token: string, isReasoning: boolean) => void): void {
    this.tokenCallback = fn;
  }

  /** Cancel the current LLM inference (e.g. for barge-in). */
  public interrupt() {
    this.currentAbortController?.abort();
    this.emit("interrupt");
  }

  /** Register a recurring background task. If task() returns a non-null string, it is enqueued as ambient input. */
  public scheduleProactiveTick(intervalMs: number, task: () => string | null): void {
    this.proactiveTasks.push({ intervalMs, task, lastRun: 0 });
    this._scheduleProactiveCheck();
  }

  private _scheduleProactiveCheck() {
    if (this.proactiveTimer) return;
    const minInterval = Math.min(...this.proactiveTasks.map((t) => t.intervalMs));
    this.proactiveTimer = setInterval(() => {
      const now = Date.now();
      for (const entry of this.proactiveTasks) {
        if (now - entry.lastRun >= entry.intervalMs) {
          entry.lastRun = now;
          const nudge = entry.task();
          if (nudge !== null) {
            this.addAmbient(nudge, { forceTick: true });
          }
        }
      }
    }, minInterval);
  }

  public async start() {
    for (const plugin of this.plugins) {
      plugin.onInit?.(this);
    }
    for (const source of this.inputSources) {
      await source.start();
    }
    logger.info("BaseAgent", `Starting ${this.name} with ${this.plugins.length} plugins`);
    this.scheduleTick();
  }

  public pause() {
    this.isPaused = true;
    if (this.tickTimer) { clearTimeout(this.tickTimer); this.tickTimer = null; }
  }

  public resume() {
    this.isPaused = false;
    this.tick();
  }

  private scheduleTick() {
    if (this.isPaused) return;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(
      () => this.tick(),
      this.config.heartbeatInterval ?? 3000,
    );
  }

  private async tick() {
    if (this.isThinking) return;
    if (this.tickTimer) clearTimeout(this.tickTimer);

    const direct = [...this.directQueue];
    const ambient = [...this.ambientQueue];
    this.directQueue = [];
    this.ambientQueue = [];

    if (direct.length > 0 || ambient.length > 0) {
      logger.debug("BaseAgent", `Tick fired — direct=${direct.length} ambient=${ambient.length}`);
      try {
        await this.act(direct, ambient);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit("error", err);
        for (const plugin of this.plugins) {
          try {
            plugin.onError?.(err);
          } catch {}
        }
      } finally {
        this.isThinking = false;
        this.emit("state_change", "idle");
      }
    }

    this.scheduleTick();
  }

  private async act(direct: string[], ambient: string[]) {
    this.isThinking = true;
    this.emit("state_change", "thinking");
    this.currentAbortController = new AbortController();

    // Collect conversation history from plugins
    const messages: Message[] = [];
    for (const plugin of this.plugins) {
      if (plugin.getMessages) {
        try {
          const pluginMessages = await plugin.getMessages(this.config.historyLimit ?? 20);
          logger.debug("BaseAgent", `Plugin ${plugin.name} provided ${pluginMessages.length} messages`);
          messages.push(...(pluginMessages as Message[]));
        } catch (e) {
          logger.error("BaseAgent", `Plugin error in ${plugin.name}:`, e);
        }
      }
    }

    // Append the current input as the latest user message
    const allInputs = [...direct, ...ambient];
    const userContent = allInputs.join("\n");
    messages.push({ role: "user", content: userContent });
    logger.info("BaseAgent", `User input: "${userContent.slice(0, 100)}${userContent.length > 100 ? "…" : ""}"`);

    // Collect system prompt fragments and context from plugins
    const systemPromptFragments: string[] = [];
    let pluginContext = "";

    for (const plugin of this.plugins) {
      if (plugin.getSystemPromptFragment) {
        const fragment = plugin.getSystemPromptFragment();
        if (fragment) systemPromptFragments.push(fragment);
      }
      if (plugin.getContext) {
        try {
          logger.debug("BaseAgent", `Collecting context from ${plugin.name}`);
          const ctx = await plugin.getContext(allInputs);
          if (ctx) {
            logger.debug("BaseAgent", `Context from ${plugin.name}: "${ctx.slice(0, 120)}${ctx.length > 120 ? "…" : ""}"`);
            pluginContext += `\n${plugin.name}: ${ctx.trim()}`;
          }
        } catch (e) {
          logger.error("BaseAgent", `Plugin error in ${plugin.name}:`, e);
        }
      }
    }

    // Collect tools from plugins, wiring executeTool as implementation fallback
    const tools: ToolDefinition[] = [];
    for (const plugin of this.plugins) {
      if (plugin.getTools) {
        const pluginTools = plugin.getTools();
        for (const t of pluginTools) {
          if (!t.implementation && plugin.executeTool) {
            const toolName = t.name;
            t.implementation = (args) => {
              this.emit("tool_call", toolName, args);
              return plugin.executeTool!(toolName, args);
            };
          }
        }
        tools.push(...pluginTools);
      }
    }
    logger.info("BaseAgent", `Dispatching to LLM — messages=${messages.length} tools=${tools.map((t) => t.name).join(", ")}`);
    logger.debug("BaseAgent", `System prompt (${systemPromptFragments.length} fragments):\n${this.buildSystemPrompt(direct.length > 0, pluginContext, systemPromptFragments).slice(0, 400)}…`);

    const mustRespond = direct.length > 0;
    const systemPrompt = this.buildSystemPrompt(
      mustRespond,
      pluginContext,
      systemPromptFragments,
    );

    // Notify plugins of the incoming user message
    await this.dispatchMessage("user", userContent, "input");

    const { response, nonReasoningContent, reasoningText } = await this.llm.chat(messages, systemPrompt, undefined, tools, this.tokenCallback);
    logger.info("BaseAgent", `LLM response received (${response.length} chars)`);

    if (reasoningText) logger.debug("BaseAgent", `Reasoning extracted (${reasoningText.length} chars)`);
    this.emit("thought", reasoningText);
    this.emit("log", `[Response]: ${response}`);

    const cleanResponse = nonReasoningContent;

    // Ambient-only: respect the model's choice to stay silent
    if (!mustRespond && cleanResponse.includes(this.IGNORE_KEYWORD)) {
      return;
    }

    // Allow plugins to augment or replace the response before it is spoken
    let finalResponse = cleanResponse;
    for (const plugin of this.plugins) {
      if (plugin.augmentResponse) {
        try {
          finalResponse = await plugin.augmentResponse(finalResponse);
        } catch (e) {
          logger.error("BaseAgent", `Plugin error in ${plugin.name}:`, e);
        }
      }
    }

    logger.debug("BaseAgent", "Dispatching assistant message to plugins");
    await this.dispatchMessage("assistant", finalResponse, "direct");
    logger.info("BaseAgent", `--- Final response (${finalResponse.length} chars) ---`);
    this.emit("speak", finalResponse);
  }

  private buildSystemPrompt(
    mustRespond: boolean,
    pluginContext: string,
    fragments: string[],
  ): string {
    const parts: string[] = [this.config.systemPrompt];

    if (mustRespond) {
      parts.push("You have received a direct message. You MUST provide a response.");
    } else {
      parts.push(
        `If the incoming perceptions do not require your engagement, respond with exactly: "${this.IGNORE_KEYWORD}"`,
      );
    }

    if (pluginContext.trim()) {
      parts.push(`Plugin Context:\n${pluginContext.trim()}`);
    }

    if (fragments.length > 0) {
      parts.push(fragments.join("\n"));
    }

    return parts.filter(Boolean).join("\n\n");
  }

  private async dispatchMessage(
    role: "user" | "assistant" | "system",
    content: string,
    source: string,
  ) {
    for (const plugin of this.plugins) {
      if (plugin.onMessage) {
        try {
          logger.debug("BaseAgent", `onMessage → ${plugin.name} (role=${role})`);
          await plugin.onMessage(role, content, source);
        } catch (e) {
          logger.error("BaseAgent", `Plugin error in ${plugin.name}:`, e);
        }
      }
    }
  }
}
