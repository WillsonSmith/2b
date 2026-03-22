import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import { logger } from "../logger.ts";

export class TimePlugin implements AgentPlugin {
  name = "Time";

  onInit(_agent: BaseAgent) {
    logger.info("Time", "Plugin initialized.");
  }

  getContext() {
    return `The current time is ${new Date().toLocaleTimeString()}`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "get_current_time",
        description: "Returns the current local time and date.",
        parameters: { type: "object", properties: {} },
      },
    ];
  }

  async executeTool(name: string, _args: any) {
    if (name === "get_current_time") {
      return new Date().toString();
    }
    throw new Error(`Tool ${name} not found in TimePlugin`);
  }
}
