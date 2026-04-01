import { BaseAgent } from "./BaseAgent.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { AgentPlugin } from "./Plugin.ts";
import type { InputSource } from "./InputSource.ts";
import type { AgentConfig, AgentEventMap, AmbientOptions } from "./types.ts";
import { CortexMemoryPlugin } from "../plugins/CortexMemoryPlugin.ts";
import { ThoughtPlugin } from "../plugins/ThoughtPlugin.ts";
import { MetacognitionPlugin } from "../plugins/MetacognitionPlugin.ts";
import { SourceReaderPlugin } from "../plugins/SourceReaderPlugin.ts";

export class CortexAgent<TEvents extends AgentEventMap = AgentEventMap> {
  private inner: BaseAgent;
  public readonly memoryPlugin: CortexMemoryPlugin;

  constructor(llm: LLMProvider, config: AgentConfig, synthesisProvider?: LLMProvider) {
    const cortexSystemPrompt = [
      config.systemPrompt,
      "You have internal thoughts stored in thought memory. Review recent thoughts before responding.",
      "You may act proactively — don't only respond to explicit requests.",
      "Question the coherence of ideas you encounter. Look for contradictions.",
    ]
      .filter(Boolean)
      .join("\n\n");

    this.inner = new BaseAgent(llm, { ...config, systemPrompt: cortexSystemPrompt });

    // cortexName determines the memory namespace. Falls back to config.name then "cortex".
    // Multiple unnamed CortexAgent instances will share the "cortex" namespace — assign
    // config.cortexName or config.name explicitly when running more than one concurrently.
    const cortexName = config.cortexName ?? config.name ?? "cortex";
    this.memoryPlugin = new CortexMemoryPlugin(llm, cortexName, config.memoryDbPath);
    const thoughtPlugin = new ThoughtPlugin(this.memoryPlugin, synthesisProvider ?? null);

    const sourceRoot = new URL("../..", import.meta.url).pathname;
    const sourceReaderPlugin = new SourceReaderPlugin({ sourceRoot });
    const metacognitionPlugin = new MetacognitionPlugin(this.memoryPlugin);

    this.inner.registerPlugin(this.memoryPlugin);
    this.inner.registerPlugin(thoughtPlugin);
    this.inner.registerPlugin(sourceReaderPlugin);
    this.inner.registerPlugin(metacognitionPlugin);
  }

  /** Register an additional plugin with the underlying agent. */
  public registerPlugin(plugin: AgentPlugin): this {
    this.inner.registerPlugin(plugin);
    return this;
  }

  /** Attach an input source that feeds direct and ambient events to the agent. */
  public addInputSource(source: InputSource): this {
    this.inner.addInputSource(source);
    return this;
  }

  /** Start all plugins and input sources, then begin the heartbeat loop. */
  public async start(): Promise<void> {
    await this.inner.start();
  }

  /** Stop the heartbeat loop, proactive timer, and all input sources. */
  public async stop(): Promise<void> {
    await this.inner.stop();
  }

  /** Queue input that requires a response and immediately schedule a tick. */
  public addDirect(text: string): void {
    this.inner.addDirect(text);
  }

  /** Queue passive perception. The agent may choose to ignore it. */
  public addAmbient(text: string, opts?: AmbientOptions): void {
    this.inner.addAmbient(text, opts);
  }

  /** Cancel the current LLM inference (e.g. for barge-in). */
  public interrupt(): void {
    this.inner.interrupt();
  }

  /** Register a callback that receives each token as the LLM streams its response. */
  public setTokenCallback(fn: (token: string, isReasoning: boolean) => void): void {
    this.inner.setTokenCallback(fn);
  }

  /** Register a recurring background task. If task() returns a non-null string it is enqueued as ambient input. */
  public scheduleProactiveTick(intervalMs: number, task: () => string | null): void {
    this.inner.scheduleProactiveTick(intervalMs, task);
  }

  /** Suspend the heartbeat loop and proactive timer without discarding queued input. */
  public pause(): void {
    this.inner.pause();
  }

  /** Resume the heartbeat loop and proactive timer after a pause(). */
  public resume(): void {
    this.inner.resume();
  }

  /**
   * Subscribe to an agent event.
   * Note: returns `this` (CortexAgent) for fluent chaining; the BaseAgent return value is intentionally discarded.
   */
  public on<K extends keyof TEvents & string>(event: K, listener: (...args: TEvents[K] & any[]) => void): this {
    this.inner.on(event, listener);
    return this;
  }

  /**
   * Subscribe to an agent event for a single emission.
   * Note: returns `this` (CortexAgent) for fluent chaining; the BaseAgent return value is intentionally discarded.
   */
  public once<K extends keyof TEvents & string>(event: K, listener: (...args: TEvents[K] & any[]) => void): this {
    this.inner.once(event, listener);
    return this;
  }

  /**
   * Unsubscribe from an agent event.
   * Note: returns `this` (CortexAgent) for fluent chaining; the BaseAgent return value is intentionally discarded.
   */
  public off<K extends keyof TEvents & string>(event: K, listener: (...args: TEvents[K] & any[]) => void): this {
    this.inner.off(event, listener);
    return this;
  }

  public get name(): string {
    return this.inner.name;
  }
}
