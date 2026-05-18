import type { AgentPlugin } from "@2b/framework/core/Plugin.ts";
import { HeadlessAgent } from "@2b/framework/core/HeadlessAgent.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const SYSTEM = `You are filling in a single block inside a Markdown document. The user inserted an "AI Fill" placeholder block with a written instruction for what should go there. Your job is to produce the content for that block.

Rules:
- Output ONLY the content for the block. No preamble, no "here is", no commentary, no code fences around the whole answer.
- Output raw Markdown. Use headings, lists, paragraphs, links, and code fences (with language tags) as appropriate.
- Stay consistent with the surrounding document's voice, register, and structure.
- If referenced files are provided, treat them as authoritative context.
- Do not repeat the user's instruction verbatim; act on it.`;

const MAX_DOC_CHARS = 20_000;
const MAX_MENTION_CHARS = 8_000;

export class AIFillPlugin implements AgentPlugin {
  name = "AIFill";
  private config: EpistemeConfig;
  private agent: HeadlessAgent | null = null;

  constructor(config: EpistemeConfig) {
    this.config = config;
  }

  private getAgent(): HeadlessAgent {
    if (!this.agent) {
      const llm = createProvider(featureModel(this.config, "default"));
      this.agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "AIFill" });
    }
    return this.agent;
  }

  getSystemPromptFragment(): string {
    return "";
  }

  getTools() {
    return [];
  }

  async executeTool(): Promise<string> {
    throw new Error("AIFillPlugin exposes no tools");
  }

  async generate(
    instruction: string,
    documentContent: string,
    mentions: Array<{ path: string; content: string }>,
  ): Promise<string> {
    const docBlock = documentContent.trim()
      ? `Current document:\n\`\`\`markdown\n${documentContent.slice(0, MAX_DOC_CHARS)}\n\`\`\`\n`
      : "";

    const mentionBlock = mentions.length > 0
      ? mentions
          .map((m) =>
            `Referenced file: ${m.path}\n\`\`\`\n${m.content.slice(0, MAX_MENTION_CHARS)}\n\`\`\``,
          )
          .join("\n\n") + "\n\n"
      : "";

    const prompt = `${docBlock}${mentionBlock}Instruction for this block:\n${instruction}\n\nWrite the block content now.`;
    const raw = await this.getAgent().ask(prompt);
    return stripWrappingFence(raw.trim());
  }
}

function stripWrappingFence(text: string): string {
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return fenced ? fenced[1]!.trim() : text;
}
