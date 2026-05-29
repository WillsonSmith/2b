import { z } from "zod";
import { HeadlessAgent } from "@2b/framework/core/HeadlessAgent.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../../config.ts";
import { featureModel } from "../../config.ts";

const SYSTEM = `You write a single section of a writing style guide. The user gives a plain-language description of the style they want. Produce one focused section that an AI writing assistant can follow directly.

Produce a short title (1-4 words) and a body in raw Markdown.

Rules for the body:
- Imperative voice. "Use active verbs", never "active verbs should be used".
- One concern only. If the description mixes several (voice + formatting + vocabulary), pick the dominant one and write that; do not sprawl.
- 80-250 words. Prefer a short intro line followed by a bullet list of rules.
- Concrete and checkable. "Break any sentence over 25 words" beats "be concise".
- No "you are..." preamble — the assistant already has an identity.
- No commentary, no "here is".`;

/**
 * A generated style-guide section: a short `title` and a Markdown `body`.
 * Used with `askStructured` to replace the `TITLE:`-line parsing — the model
 * returns this object directly. Kept as `body` (not `content`) because
 * StyleGuidePlugin consumes `.body`.
 */
export const generatedSectionSchema = z.object({
  title: z.string(),
  body: z.string(),
});

export type GeneratedSection = z.infer<typeof generatedSectionSchema>;

/**
 * One-shot LLM generation of a style-guide section from a plain-language
 * description. A standalone helper (not a registered plugin and not an agent
 * tool): the always-on StyleGuidePlugin stays tool-free, and generation is an
 * explicit, reviewed Settings action. Mirrors AIFillPlugin's HeadlessAgent
 * shape.
 */
export class StyleGuideGenerator {
  private agent: HeadlessAgent | null = null;

  constructor(private readonly config: EpistemeConfig) {}

  private getAgent(): HeadlessAgent {
    if (!this.agent) {
      const llm = createProvider(featureModel(this.config, "styleGuide"));
      this.agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "StyleGuideGen" });
    }
    return this.agent;
  }

  async generate(description: string): Promise<GeneratedSection> {
    const section = await this.getAgent().askStructured<GeneratedSection>(
      `Style description:\n${description.trim()}\n\nWrite the section now.`,
      generatedSectionSchema,
    );
    return finalizeSection(section, description);
  }
}

/** Derive a fallback title from the description's first few words. */
export function fallbackTitle(description: string): string {
  const words = description.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) return "Untitled";
  const joined = words.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * Tidy a validated section: trim the body and substitute a description-derived
 * title when the model returned a blank one. Exported for unit testing.
 */
export function finalizeSection(section: GeneratedSection, description = ""): GeneratedSection {
  return {
    title: section.title.trim() || fallbackTitle(description),
    body: section.body.trim(),
  };
}
