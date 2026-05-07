import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

export interface TocEntry {
  level: number;
  text: string;
  description: string;
  id: string;
}

export interface DocSection {
  level: number;
  heading: string;
  content: string;
}

const SYSTEM = `You are a document outliner. Given a list of document headings and their following text, generate a one-sentence description for each section.

Return a JSON array where each element has:
- "heading": the exact heading text
- "description": a single sentence (max 15 words) describing what the section covers

Return ONLY the JSON array, no prose, no code fences.`;

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
    const raw = await agent.ask(
      `Generate descriptions for these ${sections.length} sections:\n\n${JSON.stringify(input, null, 2)}`,
    );
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return fallbackEntries(sections);

    return sections.map((s, i) => {
      const item = parsed[i] as { heading?: string; description?: string } | undefined;
      return {
        level: s.level,
        text: s.heading,
        description: item?.description?.trim() ?? "",
        id: slugify(s.heading),
      };
    });
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
