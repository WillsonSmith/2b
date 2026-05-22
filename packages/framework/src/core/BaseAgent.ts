/**
 * BaseAgent — core event-driven orchestrator for the 2b agent framework.
 *
 * Manages two input queues and a heartbeat tick loop:
 *   - directQueue  — messages that require an LLM response (addDirect)
 *   - ambientQueue — passive perceptions; the LLM may reply [IGNORE] (addAmbient)
 *
 * Each tick drains both queues, assembles a system prompt from all plugins,
 * collects conversation history, builds the tool list, calls the LLM, dispatches
 * the response to plugins via onMessage, and emits "speak". Then schedules the
 * next heartbeat.
 *
 * Plugin hooks called per tick (all wrapped in try-catch):
 *   getSystemPromptFragment, getContext, getTools, executeTool,
 *   onMessage, augmentResponse, onBeforeToolCall
 *
 * Tool dispatch: buildTools() wraps every plugin tool with permission gating
 * (via PermissionManager) and veto checks (onBeforeToolCall). The result is
 * cached in cachedTools and invalidated when new plugins are registered.
 *
 * Critical: this class is on every message path. Every user turn goes through
 * tick() → act(). Errors in act() are caught, the queues are restored, and the
 * "error" event is emitted — the tick loop continues.
 *
 * Use CortexAgent instead of BaseAgent directly for all new agents.
 */
import { EventEmitter } from "node:events";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { AgentPlugin, ToolDefinition } from "./Plugin.ts";
import type { InputSource } from "./InputSource.ts";
import type { AgentConfig, AmbientOptions, Message, MemoryWriteRequest, TickMetrics } from "./types.ts";
import { YieldInterruptedError, YieldSignal } from "./types.ts";
import { logger } from "../logger.ts";
import { setPlatform } from "../platform/platform.ts";

export class BaseAgent extends EventEmitter {
  private isThinking = false;
  private isPaused = false;
  private lastSystemPrompt = "";
  private directQueue: string[] = [];
  private ambientQueue: string[] = [];
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private plugins: AgentPlugin[] = [];
  /**
   * Tool list built once from all registered plugins and reused every tick.
   * Set to null by registerPlugin() so the next tick rebuilds it automatically
   * if plugins are added after start(). Tools never change mid-tick.
   */
  private cachedTools: ToolDefinition[] | null = null;
  private inputSources: InputSource[] = [];
  private currentAbortController: AbortController | null = null;
  private readonly IGNORE_KEYWORD = "[IGNORE]";
  private tokenCallback: ((token: string, isReasoning: boolean) => void) | undefined = undefined;
  private proactiveTasks: Array<{ intervalMs: number; task: () => string | null; lastRun: number }> = [];
  private proactiveTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Resolver set by yieldControl(). When non-null the agent is suspended mid-turn
   * awaiting continuation input. The next addDirect() call resolves it instead of
   * enqueuing, allowing the in-flight LLM tool loop to resume.
   */
  private yieldResolver: ((input: string) => void) | null = null;
  /**
   * Per-tick map of tool name → invocation count. Reset at the start of every act().
   * Read by emitTickMetrics() so each TickMetrics records which tools the LLM
   * actually invoked this turn.
   */
  private currentTickToolCalls: Record<string, number> = {};
  /**
   * Per-tick total of retry attempts charged across all tool calls. Incremented
   * by the buildTools wrapper each time it loops past its first attempt. Reset
   * at the start of every act() and surfaced through TickMetrics.retries.
   */
  private currentTickRetries = 0;

  public get name(): string {
    return this.config.name ?? "Agent";
  }

  constructor(
    private llm: LLMProvider,
    private config: AgentConfig,
  ) {
    super();
    if (config.platform) setPlatform(config.platform);
  }

  public registerPlugin(plugin: AgentPlugin): this {
    this.plugins.push(plugin);
    // Invalidate the tool cache so the next tick includes this plugin's tools.
    this.cachedTools = null;
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
    if (this.yieldResolver) {
      const resolver = this.yieldResolver;
      this.yieldResolver = null;
      resolver(text);
      return;
    }
    this.directQueue.push(text);
    this.tick();
  }

  /** Queue passive perception. The agent may choose to ignore it. */
  public addAmbient(text: string, opts: AmbientOptions = {}) {
    this.ambientQueue.push(text);
    if (opts.forceTick) this.tick();
  }

  /**
   * Backward-compatible shim used by existing plugins (e.g. AudioPlugin, CLIPlugin).
   * Routes [Heard] and [User said] prefixes to directQueue; everything else to ambientQueue.
   */
  public addPerception(text: string, opts: AmbientOptions = {}) {
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

  /**
   * Emit a memory persistence request to any registered memory broker plugin.
   * If no plugin (e.g. CortexMemoryPlugin) is listening, the event fires into the
   * void and the call is a graceful no-op — callers need no null guard.
   */
  public requestMemoryWrite(request: MemoryWriteRequest): void {
    this.emit("memory:write_request", request);
  }

  /**
   * Cancel the current LLM inference (e.g. for barge-in).
   *
   * Returns a Promise that resolves on the next `state_change("idle")` — i.e.
   * once the in-flight tick has unwound. If the agent is already idle, the
   * Promise resolves on the next microtask so the caller can `await` without
   * deadlocking. Callers that don't `await` are unaffected (fire-and-forget).
   */
  public interrupt(): Promise<void> {
    const wasThinking = this.isThinking;
    if (this.currentAbortController) this.currentAbortController.abort();
    this.emit("interrupt");
    if (!wasThinking) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const onIdle = (state: "idle" | "thinking") => {
        if (state !== "idle") return;
        this.off("state_change", onIdle);
        resolve();
      };
      this.on("state_change", onIdle);
    });
  }

  /** Interrupt all in-flight subagent asks without stopping the main agent. */
  public interruptSubAgents(): void {
    for (const plugin of this.plugins) {
      if ("interruptAll" in plugin && typeof (plugin as { interruptAll: unknown }).interruptAll === "function") {
        (plugin as { interruptAll(): void }).interruptAll();
        return;
      }
    }
  }

  /**
   * Interrupt all subagents and the main agent's current LLM call.
   * Returns the same idle-resolving Promise as `interrupt()`.
   */
  public interruptAll(): Promise<void> {
    this.interruptSubAgents();
    return this.interrupt();
  }

  /**
   * Cooperatively yield control mid-turn, suspending until the next addDirect() call.
   *
   * Intended to be called from within a tool's executeTool() implementation.
   * The agent emits "speak" with partialResult (if provided) and "agent_yield",
   * then blocks the tool call loop by returning a Promise that resolves only when
   * the caller supplies new direct input via addDirect().
   *
   * The resolved value (the continuation text) is returned to the LLM as the
   * tool's result, allowing the in-flight turn to continue with the new context.
   *
   * If the current AbortController fires before input arrives, the Promise rejects
   * with "Yield interrupted." — the tool loop will surface this as an error.
   */
  public yieldControl(partialResult?: string, reason?: string): Promise<string> {
    if (partialResult) this.emit("speak", partialResult);
    this.emit("agent_yield", reason, partialResult);
    return new Promise<string>((resolve, reject) => {
      this.yieldResolver = resolve;
      this.currentAbortController?.signal.addEventListener(
        "abort",
        () => {
          if (this.yieldResolver === resolve) {
            this.yieldResolver = null;
            reject(new YieldInterruptedError());
          }
        },
        { once: true },
      );
    });
  }

  /** Register a recurring background task. If task() returns a non-null string, it is enqueued as ambient input. */
  public scheduleProactiveTick(intervalMs: number, task: () => string | null): void {
    this.proactiveTasks.push({ intervalMs, task, lastRun: 0 });
    this.scheduleProactiveCheck();
  }

  private scheduleProactiveCheck() {
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

  /** Returns name and tool count for every registered plugin. */
  public getRegisteredPlugins(): Array<{ name: string; toolCount: number }> {
    return this.plugins.map((p) => ({
      name: p.name,
      toolCount: p.getTools?.().length ?? 0,
    }));
  }

  /** Returns all tools currently available across all plugins. */
  public getAvailableTools(): ToolDefinition[] {
    return this.collectTools();
  }

  /** Clears the tool cache so the next tick (or getAvailableTools call) rebuilds it. */
  public invalidateToolCache(): void {
    this.cachedTools = null;
  }

  /** Returns the assembled system prompt from the most recent tick. */
  public getLastSystemPrompt(): string {
    return this.lastSystemPrompt;
  }

  /**
   * Replace the base system prompt at runtime. The new value is used starting
   * with the next tick — in-flight ticks are unaffected. Plugin
   * getSystemPromptFragment / getContext contributions are still appended on
   * top, as they are on every tick.
   *
   * Emits `system_prompt_updated` with the value that will be used.
   */
  public setSystemPrompt(prompt: string): void {
    this.config.systemPrompt = prompt;
    this.emit("system_prompt_updated", prompt);
  }

  public async start() {
    logger.info("BaseAgent", `Starting ${this.name} with ${this.plugins.length} plugins`);
    // Initialize all plugins concurrently. allSettled is used instead of all so
    // a single failing plugin doesn't block the others from starting.
    await Promise.allSettled(this.plugins.map(p => p.onInit?.(this)));

    // After onInit, give plugins the chance to register their own InputSources.
    // Results are collected with allSettled so a failing plugin doesn't prevent
    // others from contributing sources. Sources are added via addInputSource() so
    // they appear in this.inputSources before the start loop below.
    const pluginsWithSources = this.plugins.filter(p => p.createInputSources);
    if (pluginsWithSources.length > 0) {
      const sourceResults = await Promise.allSettled(
        pluginsWithSources.map(p => p.createInputSources!(this)),
      );
      for (let i = 0; i < sourceResults.length; i++) {
        const result = sourceResults[i]!;
        const plugin = pluginsWithSources[i]!;
        if (result.status === "fulfilled") {
          for (const source of result.value) {
            this.addInputSource(source);
          }
        } else {
          logger.error("BaseAgent", `createInputSources failed in ${plugin.name}:`, result.reason);
        }
      }
    }

    for (const source of this.inputSources) {
      await source.start();
    }
    this.scheduleTick();
  }

  public async stop() {
    if (this.tickTimer) { clearTimeout(this.tickTimer); this.tickTimer = null; }
    if (this.proactiveTimer) { clearInterval(this.proactiveTimer); this.proactiveTimer = null; }
    for (const source of this.inputSources) {
      await source.stop();
    }
  }

  public pause() {
    this.isPaused = true;
    if (this.tickTimer) { clearTimeout(this.tickTimer); this.tickTimer = null; }
    if (this.proactiveTimer) { clearInterval(this.proactiveTimer); this.proactiveTimer = null; }
  }

  public resume() {
    this.isPaused = false;
    if (this.proactiveTasks.length > 0) this.scheduleProactiveCheck();
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
    if (this.isThinking) {
      // The agent is already mid-turn but new input has arrived — emit so UIs
      // can surface "your message is queued" without polling. Only fire when
      // there is something actually waiting; an empty tick re-entry is silent.
      const directDepth = this.directQueue.length;
      const ambientDepth = this.ambientQueue.length;
      if (directDepth > 0 || ambientDepth > 0) {
        this.emit("queued", { directDepth, ambientDepth });
      }
      return;
    }
    if (this.tickTimer) clearTimeout(this.tickTimer);

    const direct = [...this.directQueue];
    const ambient = [...this.ambientQueue];
    this.directQueue = [];
    this.ambientQueue = [];

    if (direct.length > 0 || ambient.length > 0) {
      logger.debug("BaseAgent", `Tick fired — direct=${direct.length} ambient=${ambient.length}`);
      this.isThinking = true;
      try {
        await this.act(direct, ambient);
      } catch (error) {
        this.directQueue.unshift(...direct);
        this.ambientQueue.unshift(...ambient);
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit("error", err);
        for (const plugin of this.plugins) {
          try {
            plugin.onError?.(err);
          } catch (e) {
            logger.error("BaseAgent", `onError handler threw in ${plugin.name}:`, e);
          }
        }
      } finally {
        this.isThinking = false;
        this.emit("state_change", "idle");
      }
    }

    this.scheduleTick();
  }

  private async collectMessages(allInputs: string[]): Promise<{ messages: Message[]; userContent: string }> {
    // Fetch history from all plugins concurrently — each plugin's store is independent.
    // allSettled keeps iteration order so message sequence matches plugin registration order
    // even when some calls finish before others.
    const pluginsWithMessages = this.plugins.filter(p => p.getMessages);
    const results = await Promise.allSettled(
      pluginsWithMessages.map(p => p.getMessages!(this.config.historyLimit ?? 20)),
    );
    const messages: Message[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      const plugin = pluginsWithMessages[i]!;
      if (result.status === "fulfilled") {
        logger.debug("BaseAgent", `Plugin ${plugin.name} provided ${result.value.length} messages`);
        messages.push(...(result.value as Message[]));
      } else {
        logger.error("BaseAgent", `Plugin error in ${plugin.name}:`, result.reason);
      }
    }
    const userContent = allInputs.join("\n");
    messages.push({ role: "user", content: userContent });
    logger.info("BaseAgent", `User input: "${userContent.slice(0, 100)}${userContent.length > 100 ? "…" : ""}"`);
    return { messages, userContent };
  }

  /** Sum of `content.length` across all messages — used for tick metrics. */
  private historySize(messages: Message[]): number {
    let total = 0;
    for (const m of messages) total += m.content.length;
    return total;
  }

  private async collectSystemPrompt(
    allInputs: string[],
    mustRespond: boolean,
  ): Promise<{
    systemPrompt: string;
    systemPromptFragments: string[];
    pluginContextMs: Record<string, number>;
    contextContributors: number;
  }> {
    const inputContext = allInputs.join(" ");

    // All plugins run concurrently to overlap their async work (e.g. embedding calls,
    // DB queries). Within each plugin, getSystemPromptFragment is awaited before
    // getContext — this ordering lets plugins that compute an embedding in
    // getSystemPromptFragment cache and reuse it in getContext (see CortexMemoryPlugin).
    // allSettled preserves plugin registration order in results, so fragment and context
    // are assembled in a deterministic sequence regardless of which plugin finishes first.
    const results = await Promise.allSettled(
      this.plugins.map(async (plugin) => {
        const pluginStart = performance.now();
        let fragment: string | undefined;
        let ctx: string | undefined;
        if (plugin.getSystemPromptFragment) {
          try {
            const f = await plugin.getSystemPromptFragment(inputContext);
            if (f) fragment = f;
          } catch (e) {
            logger.error("BaseAgent", `Plugin error in ${plugin.name} getSystemPromptFragment:`, e);
          }
        }
        if (plugin.getContext) {
          try {
            logger.debug("BaseAgent", `Collecting context from ${plugin.name}`);
            const c = await plugin.getContext(allInputs);
            if (c) ctx = c;
          } catch (e) {
            logger.error("BaseAgent", `Plugin error in ${plugin.name} getContext:`, e);
          }
        }
        return { plugin, fragment, ctx, elapsedMs: performance.now() - pluginStart };
      }),
    );

    const systemPromptFragments: string[] = [];
    const pluginContextMs: Record<string, number> = {};
    let pluginContext = "";
    let contextContributors = 0;
    for (const result of results) {
      if (result.status === "rejected") continue;
      const { plugin, fragment, ctx, elapsedMs } = result.value;
      pluginContextMs[plugin.name] = elapsedMs;
      if (fragment) systemPromptFragments.push(fragment);
      if (ctx) {
        contextContributors++;
        logger.debug("BaseAgent", `Context from ${plugin.name}: "${ctx.slice(0, 120)}${ctx.length > 120 ? "…" : ""}"`);
        pluginContext += `\n${plugin.name}: ${ctx.trim()}`;
      }
    }

    const systemPrompt = this.buildSystemPrompt(mustRespond, pluginContext, systemPromptFragments);
    this.lastSystemPrompt = systemPrompt;
    return { systemPrompt, systemPromptFragments, pluginContextMs, contextContributors };
  }

  /**
   * Assembles the complete tool list from all plugins, wrapping each tool with
   * permission checks and veto logic. Called once at startup (or after a new
   * plugin is registered) and cached by collectTools().
   */
  private buildTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const plugin of this.plugins) {
      if (plugin.getTools) {
        const pluginTools = plugin.getTools();
        for (const rawTool of pluginTools) {
          // Shallow-copy before mutating so plugins that return cached object
          // references don't have their originals modified.
          const t: ToolDefinition = { ...rawTool };
          if (!t.implementation && plugin.executeTool) {
            const toolName = t.name;
            const permission = t.permission ?? "none";
            const pm = this.config.permissionManager;
            t.implementation = async (args) => {
              // Veto runs first so a structural block doesn't first force the user
              // through an approval prompt for a call that will never execute.
              for (const vetoPlugin of this.plugins) {
                if (vetoPlugin.onBeforeToolCall) {
                  try {
                    const verdict = vetoPlugin.onBeforeToolCall(toolName, args as Record<string, unknown>);
                    if (!verdict.allow) {
                      this.emit("tool_call_blocked", toolName, args as Record<string, unknown>, verdict.reason);
                      return verdict.reason;
                    }
                  } catch (e) {
                    logger.error("BaseAgent", `onBeforeToolCall threw in ${vetoPlugin.name}:`, e);
                  }
                }
              }
              if (permission !== "none" && pm) {
                const allowed = await pm.requestApproval({
                  agentName: this.name,
                  toolName,
                  args: args as Record<string, unknown>,
                });
                if (!allowed) return { error: "Permission denied by user." };
              }
              if (this.currentAbortController?.signal.aborted) {
                return { error: "Interrupted." };
              }
              this.emit("tool_call", toolName, args);
              this.currentTickToolCalls[toolName] = (this.currentTickToolCalls[toolName] ?? 0) + 1;

              // ── Retry loop ───────────────────────────────────────────────
              const retryPolicy = rawTool.retry;
              const maxAttempts = retryPolicy?.maxAttempts ?? 1;
              let toolResult: unknown;
              let lastError: unknown = null;
              for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                if (attempt > 1 && retryPolicy) {
                  const base = retryPolicy.delayMs ?? 0;
                  const wait = retryPolicy.backoff === "exponential"
                    ? base * 2 ** (attempt - 2)
                    : base;
                  if (wait > 0) await new Promise(r => setTimeout(r, wait));
                  this.currentTickRetries++;
                  this.emit("log", `[Retry] ${toolName}: attempt ${attempt}/${maxAttempts}`);
                }
                try {
                  toolResult = await plugin.executeTool!(toolName, args);
                  lastError = null;
                  break;
                } catch (e) {
                  lastError = e;
                  // Yield interrupts and cooperative yields are intentional
                  // control-flow signals, not transient failures — retrying just
                  // produces N identical errors. Surface them once and stop.
                  if (e instanceof YieldInterruptedError || e instanceof YieldSignal) break;
                  const shouldRetry = retryPolicy?.retryOn ? retryPolicy.retryOn(e) : true;
                  if (!shouldRetry || attempt >= maxAttempts) break;
                }
              }
              if (lastError !== null) {
                const msg = lastError instanceof Error ? lastError.message : String(lastError);
                this.emit("log", `[Tool error] ${toolName} failed after ${maxAttempts} attempt(s): ${msg}`);
                this.emit("tool_result", toolName, `Tool error after ${maxAttempts} attempt(s): ${msg}`);
                return `Tool error after ${maxAttempts} attempt(s): ${msg}`;
              }
              // ── End retry loop ───────────────────────────────────────────

              if (rawTool.verifyAfter) {
                try {
                  const vr = await rawTool.verifyAfter(args as Record<string, unknown>, toolResult);
                  if (!vr.passed) {
                    this.emit("log", `[Verification failed] ${toolName}: ${vr.message}`);
                    this.emit("tool_result", toolName, `Verification failed: ${vr.message}`);
                    const resultStr = typeof toolResult === "string"
                      ? toolResult
                      : JSON.stringify(toolResult);
                    return `${resultStr}\n[Verification failed: ${vr.message}]`;
                  }
                } catch (e) {
                  this.emit("log", `[Verification error] ${toolName}: ${e instanceof Error ? e.message : String(e)}`);
                }
              }
              this.emit("tool_result", toolName);
              return toolResult;
            };
          }
          tools.push(t);
        }
      }
    }
    return tools;
  }

  /**
   * Returns the cached tool list, building it first if necessary.
   * The cache is invalidated by registerPlugin() so dynamically added plugins
   * are picked up on the next tick without rebuilding every turn.
   */
  private collectTools(): ToolDefinition[] {
    if (!this.cachedTools) {
      this.cachedTools = this.buildTools();
    }
    return this.cachedTools;
  }

  /**
   * Route a tool call through the full built wrapper for the named tool —
   * identical to what the LLM tool-call loop does. Applies permission gating,
   * onBeforeToolCall veto checks, retry policy, and verifyAfter hooks.
   *
   * Used by RetryPlugin's `retry_tool` so re-invoked tools respect the same
   * per_call approval prompts as the original call.
   *
   * Returns an error string if no tool with that name is registered.
   */
  public async dispatchTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.collectTools().find(t => t.name === toolName);
    if (!tool?.implementation) return `No tool named '${toolName}' is registered.`;
    return tool.implementation(args);
  }

  /**
   * Core per-turn handler. Called by tick() when there is input to process.
   *
   * Sequence:
   * 1. Emit state_change("thinking") and create an AbortController for this call.
   * 2. Collect conversation history from plugins (collectMessages).
   * 3. Assemble the system prompt from plugins (collectSystemPrompt).
   * 4. Get the cached tool list (collectTools).
   * 5. Call the LLM.
   * 6. If ambient-only and the response is [IGNORE], return silently.
   * 7. Run augmentResponse chain so plugins can transform the output.
   * 8. Dispatch the final response to all plugins via onMessage.
   * 9. Emit "speak" with the final response text.
   *
   * state_change("idle") is emitted in tick()'s finally block, not here.
   */
  private async act(direct: string[], ambient: string[]) {
    this.emit("state_change", "thinking");
    this.currentAbortController = new AbortController();

    const allInputs = [...direct, ...ambient];
    const mustRespond = direct.length > 0;

    // ── Metrics scaffolding ──────────────────────────────────────────────
    // All fields are populated progressively as the tick advances; the finally
    // block reads whatever was set so error ticks still emit useful partials.
    const tickStart = performance.now();
    let llmMs = 0;
    let augmentMs = 0;
    let dispatchMs = 0;
    let collectMessagesMs = 0;
    let collectSystemPromptMs = 0;
    let pluginContextMs: Record<string, number> = {};
    let contextContributors = 0;
    let systemPromptChars = 0;
    let toolsChars = 0;
    let historyChars = 0;
    let toolCount = 0;
    let ignored = false;
    let errored = false;
    const queueDepthAtStart = direct.length + ambient.length;
    this.currentTickToolCalls = {};
    this.currentTickRetries = 0;

    try {
      const collectMessagesStart = performance.now();
      const { messages, userContent } = await this.collectMessages(allInputs);
      collectMessagesMs = performance.now() - collectMessagesStart;
      historyChars = this.historySize(messages);

      const collectSystemPromptStart = performance.now();
      const { systemPrompt, systemPromptFragments, pluginContextMs: pcMs, contextContributors: cc } =
        await this.collectSystemPrompt(allInputs, mustRespond);
      collectSystemPromptMs = performance.now() - collectSystemPromptStart;
      pluginContextMs = pcMs;
      contextContributors = cc;
      systemPromptChars = systemPrompt.length;

      const tools = this.collectTools();
      toolCount = tools.length;

      // Best-effort serialize-for-size; tool params can contain non-stringifiable values
      // in adversarial cases, so fall back to a name-only estimate.
      try {
        toolsChars = JSON.stringify(tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }))).length;
      } catch {
        toolsChars = tools.reduce((s, t) => s + t.name.length + (t.description?.length ?? 0), 0);
      }

      logger.info("BaseAgent", `Dispatching to LLM — messages=${messages.length} tools=${tools.map((t) => t.name).join(", ")}`);
      logger.debug("BaseAgent", `System prompt (${systemPromptFragments.length} fragments):\n${systemPrompt.slice(0, 400)}…`);

      const llmStart = performance.now();
      const { response, nonReasoningContent, reasoningText } = await this.llm.chat(messages, systemPrompt, undefined, tools, this.tokenCallback, this.currentAbortController.signal);
      llmMs = performance.now() - llmStart;
      logger.info("BaseAgent", `LLM response received (${response.length} chars)`);

      // Dispatch the user message only after the LLM call succeeds. If the LLM
      // throws, the tick() catch restores the queues; dispatching earlier would
      // leave plugins (e.g. MemoryPlugin) with a persisted user message that
      // re-runs on the next tick — causing duplicate history entries.
      await this.dispatchMessage("user", userContent, "input");

      if (reasoningText) logger.debug("BaseAgent", `Reasoning extracted (${reasoningText.length} chars)`);
      this.emit("thought", reasoningText);
      this.emit("log", `[Response]: ${response}`);

      const cleanResponse = nonReasoningContent;

      // Ambient-only: respect the model's choice to stay silent
      if (!mustRespond && cleanResponse.includes(this.IGNORE_KEYWORD)) {
        ignored = true;
        return;
      }

      // Allow plugins to augment or replace the response before it is spoken
      const augmentStart = performance.now();
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
      augmentMs = performance.now() - augmentStart;

      logger.debug("BaseAgent", "Dispatching assistant message to plugins");
      const dispatchStart = performance.now();
      await this.dispatchMessage("assistant", finalResponse, "direct");
      dispatchMs = performance.now() - dispatchStart;
      logger.info("BaseAgent", `--- Final response (${finalResponse.length} chars) ---`);
      this.emit("speak", finalResponse);
    } catch (e) {
      errored = true;
      throw e;
    } finally {
      this.emitTickMetrics({
        totalMs: performance.now() - tickStart,
        llmMs,
        collectMessagesMs,
        collectSystemPromptMs,
        pluginContextMs,
        augmentMs,
        dispatchMs,
        systemPromptChars,
        toolsChars,
        historyChars,
        toolCount,
        contextContributors,
        toolsCalled: { ...this.currentTickToolCalls },
        ignored,
        errored,
        retries: this.currentTickRetries,
        aborted: this.currentAbortController?.signal.aborted ?? false,
        queueDepthAtStart,
      });
    }
  }

  /**
   * Emit a `tick_metrics` event and log a one-line debug summary.
   * Called once per act() invocation from the finally block, so every code
   * path (success, [IGNORE], error) produces exactly one metrics record.
   */
  private emitTickMetrics(metrics: TickMetrics): void {
    this.emit("tick_metrics", metrics);
    // One-line summary at debug level — opt-in via logger filter.
    // Format: total/llm/sysprompt-collect/msg-collect/augment/dispatch ms | chars: prompt/tools/history | tools=N ctx=N
    const callsSummary = Object.keys(metrics.toolsCalled).length === 0
      ? "none"
      : Object.entries(metrics.toolsCalled).map(([n, c]) => c === 1 ? n : `${n}×${c}`).join(",");
    const suffix = metrics.errored
      ? " [ERROR]"
      : metrics.ignored ? " [IGNORED]" : "";
    logger.debug(
      "BaseAgent",
      `[tick] ${metrics.totalMs.toFixed(0)}ms ` +
      `(llm=${metrics.llmMs.toFixed(0)} sysprompt=${metrics.collectSystemPromptMs.toFixed(0)} ` +
      `msgs=${metrics.collectMessagesMs.toFixed(0)} augment=${metrics.augmentMs.toFixed(0)} ` +
      `dispatch=${metrics.dispatchMs.toFixed(0)}) ` +
      `| prompt=${metrics.systemPromptChars}ch tools=${metrics.toolsChars}ch history=${metrics.historyChars}ch ` +
      `| tools=${metrics.toolCount} ctxBlocks=${metrics.contextContributors} called=${callsSummary}` +
      suffix,
    );
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
