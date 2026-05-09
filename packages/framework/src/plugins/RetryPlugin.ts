/**
 * RetryPlugin — exposes a `retry_tool` so the LLM can explicitly re-invoke any
 * registered tool after a transient failure, optionally with different arguments.
 *
 * Complements the automatic `retry` policy on `ToolDefinition`: automatic retry
 * is invisible to the LLM and handles transient I/O errors; `retry_tool` is
 * LLM-driven and lets the agent adapt its arguments or strategy before retrying.
 */
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import { logger } from "../logger.ts";

export class RetryPlugin implements AgentPlugin {
  name = "Retry";
  private agent: BaseAgent | null = null;

  onInit(agent: BaseAgent): void {
    this.agent = agent;
  }

  getSystemPromptFragment(): string {
    return [
      "## Retry",
      "Use `retry_tool` to explicitly re-invoke a tool that failed due to a transient error or when you want to try different arguments.",
      "Always explain why you are retrying in the `reason` field.",
    ].join("\n");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "retry_tool",
        description:
          "Re-invoke a previously called tool, optionally with different arguments. Use after a transient failure or when a revised strategy is needed. The tool runs with its original plugin routing — no permission re-check.",
        parameters: {
          type: "object",
          properties: {
            tool_name: {
              type: "string",
              description: "The exact name of the tool to retry.",
            },
            args: {
              type: "object",
              description: "Arguments to pass to the tool. Omit to use an empty args object.",
            },
            reason: {
              type: "string",
              description: "Why you are retrying — logged for observability.",
            },
          },
          required: ["tool_name", "reason"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name !== "retry_tool") return undefined;
    if (!this.agent) throw new Error("RetryPlugin not initialized — onInit was not called.");

    const { tool_name, args: toolArgs, reason } = args as {
      tool_name: string;
      args?: Record<string, unknown>;
      reason: string;
    };

    if (!tool_name || typeof tool_name !== "string") {
      return "retry_tool error: tool_name must be a non-empty string.";
    }

    logger.info(this.name, `retry_tool: retrying "${tool_name}" — ${reason}`);
    const result = await this.agent.dispatchTool(tool_name, toolArgs ?? {});
    return result;
  }
}
