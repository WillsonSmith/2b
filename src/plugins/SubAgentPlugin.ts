import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { HeadlessAgent } from "../core/HeadlessAgent.ts";
import { logger } from "../logger.ts";

const MAX_TASK_LENGTH = 10_000;

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
  name = "SubAgent";
  private readonly toolName: string;
  private readonly description: string;
  private readonly agent: HeadlessAgent;
  private readonly inactivityTimeoutMs?: number;
  private readonly absoluteTimeoutMs?: number;
  // Each executeTool() call registers its own resetInactivity function here.
  // Using a Set means concurrent invocations each track their own inactivity
  // independently, eliminating the previous race condition on a shared field.
  private readonly onActivityResetHandlers = new Set<() => void>();

  constructor({ toolName, description, agent, inactivityTimeoutMs, absoluteTimeoutMs }: SubAgentPluginOptions) {
    this.toolName = toolName;
    this.description = description;
    this.agent = agent;
    this.inactivityTimeoutMs = inactivityTimeoutMs;
    this.absoluteTimeoutMs = absoluteTimeoutMs;
  }

  onInit(agent: BaseAgent): void {
    this.agent.setToolCallHandler((name, args) => {
      for (const reset of this.onActivityResetHandlers) reset();
      agent.emit("subagent_tool_call", this.toolName, name, args);
    });
  }

  getSystemPromptFragment(): string {
    return this.description;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: this.toolName,
        description: this.description,
        parameters: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description:
                "The task or question for this sub-agent to handle. Include all relevant context it needs to complete the task — usernames, URLs, IDs, dates, and any specific facts from memory — since sub-agents have no access to your memory or conversation history.",
            },
          },
          required: ["task"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name !== this.toolName) return undefined;

    const task: string =
      typeof args.task === "string" && args.task.length > MAX_TASK_LENGTH
        ? args.task.slice(0, MAX_TASK_LENGTH)
        : args.task;

    logger.debug("SubAgentPlugin", `executing task via ${this.toolName}`);

    if (this.inactivityTimeoutMs === undefined && this.absoluteTimeoutMs === undefined) {
      return this.agent.ask(task);
    }

    let rejectTimeout: (err: Error) => void = (_err) => {};
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });

    let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
    const resetInactivity = () => {
      if (this.inactivityTimeoutMs === undefined) return;
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(
        () => rejectTimeout(new Error(`${this.toolName} timed out due to inactivity`)),
        this.inactivityTimeoutMs,
      );
    };

    let absoluteTimer: ReturnType<typeof setTimeout> | undefined;
    if (this.absoluteTimeoutMs !== undefined) {
      absoluteTimer = setTimeout(
        () => rejectTimeout(new Error(`${this.toolName} exceeded absolute timeout of ${this.absoluteTimeoutMs}ms`)),
        this.absoluteTimeoutMs,
      );
    }

    this.onActivityResetHandlers.add(resetInactivity);
    resetInactivity();

    try {
      return await Promise.race([this.agent.ask(task), timeoutPromise]);
    } finally {
      clearTimeout(inactivityTimer);
      clearTimeout(absoluteTimer);
      this.onActivityResetHandlers.delete(resetInactivity);
    }
  }
}
