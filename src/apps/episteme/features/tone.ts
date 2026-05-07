import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

export type Tone = "professional" | "casual" | "academic";

const TONE_DESCRIPTIONS: Record<Tone, string> = {
  professional: "formal, precise, and business-appropriate",
  casual: "conversational, friendly, and approachable",
  academic: "scholarly, analytical, and citation-ready",
};

const SYSTEM = `You are a prose style transformer. Rewrite the given text in the requested tone. Return ONLY the rewritten text — preserve the original meaning and structure, change only the writing style. Preserve any markdown formatting (bold, italic, lists, code) that is present. No explanations or preambles.`;

export async function transformTone(
  text: string,
  tone: Tone,
  config: EpistemeConfig,
): Promise<string> {
  const llm = createProvider(featureModel(config, "default"));
  const agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "ToneTransformer" });
  return agent.ask(`Rewrite this text to be ${TONE_DESCRIPTIONS[tone]}:\n\n${text}`);
}
