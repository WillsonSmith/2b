import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const SYSTEM = `You are a code explainer. Explain what the provided code does clearly and concisely.
Focus on the key logic, purpose, and any non-obvious decisions.
Keep the explanation under 5 sentences. Return plain prose — no markdown headers, no bullet lists.`;

export async function explainCode(
  code: string,
  language: string,
  config: EpistemeConfig,
): Promise<string> {
  const llm = createProvider(featureModel(config, "default"));
  const agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "CodeExplainer" });
  const result = await agent.ask(
    `Explain this ${language} code:\n\`\`\`${language}\n${code}\n\`\`\``,
  );
  return result.trim();
}
