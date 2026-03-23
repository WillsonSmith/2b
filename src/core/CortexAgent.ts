import { BaseAgent } from "./BaseAgent.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { AgentPlugin } from "./Plugin.ts";
import type { InputSource } from "./InputSource.ts";
import type { AgentConfig, AgentEventMap } from "./types.ts";
import { CortexMemoryPlugin } from "../plugins/CortexMemoryPlugin.ts";
import { ThoughtPlugin } from "../plugins/ThoughtPlugin.ts";

export class CortexAgent<TEvents extends AgentEventMap = AgentEventMap> {
  private inner: BaseAgent;
  public readonly memoryPlugin: CortexMemoryPlugin;

  constructor(llm: LLMProvider, config: AgentConfig) {
    const cortexSystemPrompt = [
      config.systemPrompt,
      "You have internal thoughts stored in thought memory. Review recent thoughts before responding.",
      "You may act proactively — don't only respond to explicit requests.",
      "Question the coherence of ideas you encounter. Look for contradictions.",
    ]
      .filter(Boolean)
      .join("\n\n");

    this.inner = new BaseAgent(llm, { ...config, systemPrompt: cortexSystemPrompt });

    const cortexName = config.cortexName ?? config.name ?? "cortex";
    this.memoryPlugin = new CortexMemoryPlugin(llm, cortexName);
    const thoughtPlugin = new ThoughtPlugin(this.memoryPlugin);

    this.inner.registerPlugin(this.memoryPlugin);
    this.inner.registerPlugin(thoughtPlugin);
  }

  public registerPlugin(plugin: AgentPlugin): this {
    this.inner.registerPlugin(plugin);
    return this;
  }

  public addInputSource(source: InputSource): this {
    this.inner.addInputSource(source);
    return this;
  }

  public async start(): Promise<void> {
    await this.inner.start();
  }

  public addDirect(text: string): void {
    this.inner.addDirect(text);
  }

  public addAmbient(text: string, opts?: { forceTick?: boolean }): void {
    this.inner.addAmbient(text, opts);
  }

  public interrupt(): void {
    this.inner.interrupt();
  }

  public setTokenCallback(fn: (token: string, isReasoning: boolean) => void): void {
    this.inner.setTokenCallback(fn);
  }

  public scheduleProactiveTick(intervalMs: number, task: () => string | null): void {
    this.inner.scheduleProactiveTick(intervalMs, task);
  }

  public pause(): void { this.inner.pause(); }
  public resume(): void { this.inner.resume(); }

  public on<K extends keyof TEvents & string>(event: K, listener: (...args: TEvents[K] & any[]) => void): this {
    this.inner.on(event, listener);
    return this;
  }

  public once<K extends keyof TEvents & string>(event: K, listener: (...args: TEvents[K] & any[]) => void): this {
    this.inner.once(event, listener);
    return this;
  }

  public off<K extends keyof TEvents & string>(event: K, listener: (...args: TEvents[K] & any[]) => void): this {
    this.inner.off(event, listener);
    return this;
  }

  public get name(): string {
    return this.inner.name;
  }
}
