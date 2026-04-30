import type { AgentPlugin, ToolDefinition } from "../../../core/Plugin.ts";
import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const SYSTEM = `You are a Mermaid.js diagram generator. Convert the user's description into a valid Mermaid.js diagram.
Return ONLY the raw Mermaid syntax — no code fences, no explanation, no preamble.
Default to flowchart LR unless another type is clearly more appropriate (sequenceDiagram, gantt, pie, classDiagram, etc.).`;

export class DiagramPlugin implements AgentPlugin {
  name = "Diagram";
  private config: EpistemeConfig;

  constructor(config: EpistemeConfig) {
    this.config = config;
  }

  getSystemPromptFragment(): string {
    return "Use the generate_diagram tool to create Mermaid.js diagrams from natural language descriptions.";
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "generate_diagram",
        description:
          "Convert a natural language description into a Mermaid.js diagram code block. Returns the raw Mermaid syntax ready to insert into a document.",
        parameters: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Plain English description of the diagram to generate.",
            },
          },
          required: ["description"],
        },
      },
    ];
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    if (name !== "generate_diagram") throw new Error(`Unknown tool: ${name}`);
    const description = String(args["description"] ?? "").trim();
    if (!description) return "No description provided.";
    return this.generate(description);
  }

  async generate(description: string): Promise<string> {
    const llm = createProvider(featureModel(this.config, "default"));
    const agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "DiagramGenerator" });
    const mermaid = await agent.ask(description);
    return mermaid.trim();
  }
}
