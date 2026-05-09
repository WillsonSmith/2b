import type { AgentPlugin, ToolDefinition } from "@2b/framework/core/Plugin.ts";
import { HeadlessAgent } from "@2b/framework/core/HeadlessAgent.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const SYSTEM = `You are a Mermaid.js diagram generator. Convert the user's description into a valid Mermaid.js diagram.
If document content is provided, use it as context — it is the document the user is currently editing. Use it to resolve references like "this argument", "the process above", or "the flow described here".
Return ONLY the raw Mermaid syntax — no code fences, no explanation, no preamble.
Default to flowchart LR unless another type is clearly more appropriate (sequenceDiagram, gantt, pie, classDiagram, etc.).`;

const MAX_DOC_CHARS = 20_000;

export class DiagramPlugin implements AgentPlugin {
  name = "Diagram";
  private config: EpistemeConfig;
  private agent: HeadlessAgent | null = null;

  constructor(config: EpistemeConfig) {
    this.config = config;
  }

  private getAgent(): HeadlessAgent {
    if (!this.agent) {
      const llm = createProvider(featureModel(this.config, "default"));
      this.agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "DiagramGenerator" });
    }
    return this.agent;
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

  async generate(description: string, documentContent?: string): Promise<string> {
    const doc = documentContent?.trim();
    const prompt = doc
      ? `Document:\n${doc.slice(0, MAX_DOC_CHARS)}\n\n${description}`
      : description;
    const raw = await this.getAgent().ask(prompt);
    return raw.trim()
      .replace(/^```(?:mermaid)?\s*\n?/, "")
      .replace(/\n?```\s*$/, "")
      .trim();
  }
}
