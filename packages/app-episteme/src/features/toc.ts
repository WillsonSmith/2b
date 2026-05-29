import { z } from "zod";
import { HeadlessAgent } from "@2b/framework/core/HeadlessAgent.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";
import { sectionHash } from "./tocHash.ts";

export interface TocEntry {
  level: number;
  text: string;
  description: string;
  id: string;
  contentHash?: string;
}

export interface DocSection {
  level: number;
  heading: string;
  content: string;
}

const SYSTEM = `You are a document outliner. Given a list of document headings and their following text, generate a one-sentence description for each section.

Return a "sections" list with one entry per input section, in the same order. Each entry has the exact heading text and a single sentence (max 15 words) describing what the section covers.`;

/**
 * Shape of one TOC entry the model returns. Entries are aligned to the input
 * sections by index, so the model must return one element per section in order
 * (enforced at the mapping site, not here).
 */
export const tocItemSchema = z.object({
  heading: z.string(),
  description: z.string(),
});

/**
 * The structured response. The array is wrapped in an object because local
 * models reliably populate an object-rooted schema but tend to return `[]` for
 * a top-level array under Ollama's `format`.
 */
export const tocResponseSchema = z.object({
  sections: z.array(tocItemSchema),
});

export type TocItem = z.infer<typeof tocItemSchema>;
export type TocResponse = z.infer<typeof tocResponseSchema>;

export async function generateNarrativeToc(
  sections: DocSection[],
  config: EpistemeConfig,
): Promise<TocEntry[]> {
  if (sections.length === 0) return [];

  const llm = createProvider(featureModel(config, "default"));
  const agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "TocGenerator" });

  const input = sections.map((s) => ({
    heading: s.heading,
    preview: s.content.slice(0, 300),
  }));

  try {
    // Entries are aligned to `sections` by index; the model returns one item
    // per section in order. On any parse/validation failure, fall back to
    // description-less entries.
    const { sections: items } = await agent.askStructured<TocResponse>(
      `Generate descriptions for these ${sections.length} sections:\n\n${JSON.stringify(input, null, 2)}`,
      tocResponseSchema,
    );

    return sections.map((s, i) => ({
      level: s.level,
      text: s.heading,
      description: items[i]?.description?.trim() ?? "",
      id: slugify(s.heading),
      contentHash: sectionHash(s.heading, s.content),
    }));
  } catch {
    return fallbackEntries(sections);
  }
}

function fallbackEntries(sections: DocSection[]): TocEntry[] {
  return sections.map((s) => ({
    level: s.level,
    text: s.heading,
    description: "",
    id: slugify(s.heading),
    contentHash: sectionHash(s.heading, s.content),
  }));
}

/** Extract heading sections from raw Markdown. */
export function extractSectionsFromMarkdown(markdown: string): DocSection[] {
  const lines = markdown.split("\n");
  const sections: DocSection[] = [];
  let current: DocSection | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = {
        level: headingMatch[1]!.length,
        heading: headingMatch[2]!.trim(),
        content: "",
      };
    } else if (current && line.trim()) {
      current.content += line + " ";
    }
  }

  if (current) sections.push(current);
  return sections;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 50);
}
