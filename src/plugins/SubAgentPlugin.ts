import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import type { HeadlessAgent } from "../core/HeadlessAgent.ts";

interface SubAgentPluginOptions {
  toolName: string;
  description: string;
  agent: HeadlessAgent;
}

export class SubAgentPlugin implements AgentPlugin {
  name: string;
  private readonly toolName: string;
  private readonly description: string;
  private readonly agent: HeadlessAgent;

  constructor({ toolName, description, agent }: SubAgentPluginOptions) {
    this.name = toolName;
    this.toolName = toolName;
    this.description = description;
    this.agent = agent;
  }

  onInit(agent: BaseAgent): void {
    this.agent.setToolCallHandler((name, args) => agent.emit("tool_call", name, args));
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
              description: "The task or question for this sub-agent to handle.",
            },
          },
          required: ["task"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name === this.toolName) {
      return this.agent.ask(args.task);
    }
  }
}
