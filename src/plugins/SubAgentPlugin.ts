import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { HeadlessAgent } from "../core/HeadlessAgent.ts";

interface SubAgentPluginOptions {
  toolName: string;
  description: string;
  agent: HeadlessAgent;
  /** Reset this timer on each sub-agent tool call. undefined = no inactivity timeout. */
  inactivityTimeoutMs?: number;
  /** Hard cap on the entire ask() call. undefined = no absolute timeout. */
  absoluteTimeoutMs?: number;
}

export class SubAgentPlugin implements AgentPlugin {
  name: string;
  private readonly description: string;
  private readonly agent: HeadlessAgent;
  private readonly inactivityTimeoutMs?: number;
  private readonly absoluteTimeoutMs?: number;
  // NOTE: onActivityReset is set/cleared per executeTool() call. Concurrent ask()
  // calls on the same SubAgentPlugin instance would race on this field — the second
  // call overwrites the first's reset function, leaving the first without inactivity
  // tracking. In practice the orchestrator calls sub-agents serially so this is safe,
  // but do not reuse a single SubAgentPlugin instance across parallel invocations.
  private onActivityReset?: () => void;

  constructor({ toolName, description, agent, inactivityTimeoutMs, absoluteTimeoutMs }: SubAgentPluginOptions) {
    this.name = toolName;
    this.description = description;
    this.agent = agent;
    this.inactivityTimeoutMs = inactivityTimeoutMs;
    this.absoluteTimeoutMs = absoluteTimeoutMs;
  }

  onInit(agent: BaseAgent): void {
    this.agent.setToolCallHandler((name, args) => {
      this.onActivityReset?.();
      agent.emit("tool_call", name, args);
    });
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: this.name,
        description: this.description,
        parameters: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description: "The task or question for this sub-agent to handle.",
            },
          },
          required: ["task"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name !== this.name) return undefined;

    if (this.inactivityTimeoutMs === undefined && this.absoluteTimeoutMs === undefined) {
      return this.agent.ask(args.task);
    }

    let rejectTimeout!: (err: Error) => void;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });

    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    const resetInactivity = () => {
      if (this.inactivityTimeoutMs === undefined) return;
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(
        () => rejectTimeout(new Error(`${this.name} timed out due to inactivity`)),
        this.inactivityTimeoutMs,
      );
    };

    let absoluteTimer: ReturnType<typeof setTimeout> | undefined;
    if (this.absoluteTimeoutMs !== undefined) {
      absoluteTimer = setTimeout(
        () => rejectTimeout(new Error(`${this.name} exceeded absolute timeout of ${this.absoluteTimeoutMs}ms`)),
        this.absoluteTimeoutMs,
      );
    }

    this.onActivityReset = resetInactivity;
    resetInactivity();

    try {
      return await Promise.race([this.agent.ask(args.task), timeoutPromise]);
    } finally {
      clearTimeout(inactivityTimer);
      clearTimeout(absoluteTimer);
      this.onActivityReset = undefined;
    }
  }
}
