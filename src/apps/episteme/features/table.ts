import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const SYSTEM = `You are a Markdown table generator. Convert the user's description or bullet list into a well-structured Markdown table.
Return ONLY the Markdown table — no explanation, no code fences, no prose before or after.
Use | separators and include a header row with alignment dashes.`;

/** Generate a Markdown table from a description or a selected bullet list. */
export async function generateTable(
  input: string,
  config: EpistemeConfig,
): Promise<string> {
  const llm = createProvider(featureModel(config, "default"));
  const agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "TableGenerator" });
  const result = await agent.ask(input);
  return result.trim();
}
