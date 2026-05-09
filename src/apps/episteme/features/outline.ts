import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const OUTLINE_SYSTEM = `Generate a hierarchical Markdown outline for the given topic. Return only the outline, no prose or explanation.

Use # for top-level sections, ## for subsections, ### for sub-subsections. Use - bullet points under sections for key points. Keep it concise — 10-20 items total.`;

export async function generateOutline(
  topic: string,
  config: EpistemeConfig,
): Promise<string> {
  const llm = createProvider(featureModel(config, "default"));
  const agent = new HeadlessAgent(llm, [], OUTLINE_SYSTEM, {
    agentName: "OutlineGenerator",
  });
  return agent.ask(`Generate an outline for: ${topic}`);
}
