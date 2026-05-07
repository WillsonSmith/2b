import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const SYSTEM = `You are a document summarizer. Write a concise 1-3 sentence summary of the given text. Return ONLY the summary sentence(s), with no preamble or explanation.`;

export async function summarizeSection(
  text: string,
  config: EpistemeConfig,
): Promise<string> {
  const llm = createProvider(featureModel(config, "default"));
  const agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "Summarizer" });
  return agent.ask(`Summarize this:\n\n${text}`);
}
