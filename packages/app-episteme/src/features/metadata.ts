import { z } from "zod";
import { HeadlessAgent } from "@2b/framework/core/HeadlessAgent.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const SYSTEM = `You are a document metadata generator. Given a document title and its opening content, produce its metadata:
- title: the document title
- tags: 3-6 relevant topic tags, lowercase and hyphenated
- date: today's ISO date (YYYY-MM-DD)
- summary: one sentence describing the document's purpose`;

/**
 * Shape the metadata generator must return. Passed to `askStructured` so the
 * model is constrained to this object (no fence-stripping or field guards) and
 * the parsed result is runtime-validated. `tags` requires at least one entry;
 * the prompt asks for 3-6.
 */
export const frontmatterSchema = z.object({
  title: z.string(),
  tags: z.array(z.string()).min(1),
  date: z.string(),
  summary: z.string(),
});

export type FrontmatterData = z.infer<typeof frontmatterSchema>;

export async function generateFrontmatter(
  title: string,
  preview: string,
  config: EpistemeConfig,
): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const llm = createProvider(featureModel(config, "default"));
  const agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "MetadataGenerator" });

  // askStructured constrains the model to frontmatterSchema and validates the
  // result, so the fields below are guaranteed present and correctly typed.
  const data = await agent.askStructured<FrontmatterData>(
    `Title: ${title}\nToday's date: ${today}\n\nDocument preview:\n${preview.slice(0, 500)}`,
    frontmatterSchema,
  );

  return [
    `title: ${JSON.stringify(data.title)}`,
    `tags: [${data.tags.map((t) => JSON.stringify(t)).join(", ")}]`,
    `date: ${JSON.stringify(data.date)}`,
    `summary: ${JSON.stringify(data.summary)}`,
  ].join("\n");
}

export { parseFrontmatter, injectFrontmatter } from "./frontmatter.ts";
