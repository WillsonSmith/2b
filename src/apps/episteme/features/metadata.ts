import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const SYSTEM = `You are a document metadata generator. Given a document title and its opening content, generate YAML frontmatter fields.

Return ONLY the raw YAML field lines — no --- delimiters, no code fences, no explanation:
- title: the document title (quoted string)
- tags: array of 3-6 relevant topic tags (lowercase, hyphenated)
- date: today's ISO date (YYYY-MM-DD)
- summary: one sentence describing the document's purpose

Example output:
title: "Research on Cognitive Biases"
tags: ["psychology", "cognitive-biases", "decision-making"]
date: "2024-01-15"
summary: "An exploration of common cognitive biases and their effects on decision-making."`;

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
  // Strip stray markdown fences or --- delimiters the model sometimes adds despite instructions
  return raw
    .split("\n")
    .filter((line) => !/^```/.test(line) && line.trim() !== "---")
    .join("\n")
    .trim();
}

/** Parse existing YAML frontmatter block. Returns yaml content and the body after it. */
export function parseFrontmatter(markdown: string): { yaml: string | null; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (match) {
    return { yaml: match[1] ?? null, body: match[2] ?? "" };
  }
  return { yaml: null, body: markdown };
}

/** Insert or replace YAML frontmatter at the top of a Markdown document. */
export function injectFrontmatter(markdown: string, yamlContent: string): string {
  const { body } = parseFrontmatter(markdown);
  return `---\n${yamlContent}\n---\n\n${body.trimStart()}`;
}
