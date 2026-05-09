import { HeadlessAgent } from "@2b/framework/core/HeadlessAgent.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const SYSTEM = `You are a document metadata generator. Given a document title and its opening content, return a JSON object with exactly these keys:
- title: the document title (string)
- tags: array of 3-6 relevant topic tags (lowercase, hyphenated strings)
- date: today's ISO date as a string (YYYY-MM-DD)
- summary: one sentence describing the document's purpose (string)

Return ONLY the raw JSON object — no markdown, no code fences, no explanation.

Example output:
{"title":"Research on Cognitive Biases","tags":["psychology","cognitive-biases","decision-making"],"date":"2024-01-15","summary":"An exploration of common cognitive biases and their effects on decision-making."}`;

interface FrontmatterData {
  title: string;
  tags: string[];
  date: string;
  summary: string;
}

export async function generateFrontmatter(
  title: string,
  preview: string,
  config: EpistemeConfig,
): Promise<string> {
  const today = new Date().toISOString().split("T")[0];
  const llm = createProvider(featureModel(config, "default"));
  const agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "MetadataGenerator" });
  const raw = await agent.ask(
    `Title: ${title}\nToday's date: ${today}\n\nDocument preview:\n${preview.slice(0, 500)}`,
  );

  // Extract JSON — strip any accidental fences or surrounding text
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Model did not return a JSON object");
  const data: FrontmatterData = JSON.parse(jsonMatch[0]);

  if (!data.title || !Array.isArray(data.tags) || !data.date || !data.summary) {
    throw new Error("Model returned incomplete frontmatter fields");
  }

  return [
    `title: ${JSON.stringify(String(data.title))}`,
    `tags: [${data.tags.map((t) => JSON.stringify(String(t))).join(", ")}]`,
    `date: ${JSON.stringify(String(data.date))}`,
    `summary: ${JSON.stringify(String(data.summary))}`,
  ].join("\n");
}

export { parseFrontmatter, injectFrontmatter } from "./frontmatter.ts";
