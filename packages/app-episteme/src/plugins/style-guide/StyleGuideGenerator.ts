import { HeadlessAgent } from "@2b/framework/core/HeadlessAgent.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../../config.ts";
import { featureModel } from "../../config.ts";

const SYSTEM = `You write a single section of a writing style guide. The user gives a plain-language description of the style they want. Produce one focused section that an AI writing assistant can follow directly.

Output format — output nothing else:
- A first line of exactly "TITLE:" followed by a short title (1-4 words).
- The remaining lines: the section body in raw Markdown.

Rules for the body:
- Imperative voice. "Use active verbs", never "active verbs should be used".
- One concern only. If the description mixes several (voice + formatting + vocabulary), pick the dominant one and write that; do not sprawl.
- 80-250 words. Prefer a short intro line followed by a bullet list of rules.
- Concrete and checkable. "Break any sentence over 25 words" beats "be concise".
- No "you are..." preamble — the assistant already has an identity.
- No commentary, no "here is", no code fences around the whole answer.`;

export interface GeneratedSection {
  title: string;
  body: string;
}

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
      const llm = createProvider(featureModel(this.config, "default"));
      this.agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "StyleGuideGen" });
    }
    return this.agent;
  }

  async generate(description: string): Promise<GeneratedSection> {
    const raw = await this.getAgent().ask(
      `Style description:\n${description.trim()}\n\nWrite the section now.`,
    );
    return parseTitleAndBody(raw, description);
  }
}

/** Strip a code fence wrapping the whole answer, like AIFillPlugin does. */
function stripWrappingFence(text: string): string {
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return fenced ? fenced[1]!.trim() : text;
}

/**
 * Drop leading lines that are a literal echo of a format placeholder. Smaller
 * models sometimes emit the prompt's structural hints (e.g. "<blank line>")
 * verbatim instead of acting on them.
 */
function stripPlaceholderLines(body: string): string {
  const lines = body.split("\n");
  while (lines.length > 0 && /^\s*<[^>]+>\s*$/.test(lines[0]!)) lines.shift();
  return lines.join("\n").trim();
}

/** Derive a fallback title from the description's first few words. */
function fallbackTitle(description: string): string {
  const words = description.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (words.length === 0) return "Untitled";
  const joined = words.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * Parse the model output. Expects `TITLE: ...` on the first non-empty line,
 * then the body. Defends against a missing title and a wrapping fence. Exported
 * for unit testing.
 */
export function parseTitleAndBody(raw: string, description = ""): GeneratedSection {
  const cleaned = stripWrappingFence(raw.trim());
  const lines = cleaned.split("\n");

  // Find the first non-empty line; check it for a TITLE: prefix.
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === "") i++;
  const first = lines[i]?.trim() ?? "";
  const match = first.match(/^TITLE:\s*(.*)$/i);

  if (match) {
    const title = match[1]!.trim() || fallbackTitle(description);
    const body = stripPlaceholderLines(lines.slice(i + 1).join("\n").trim());
    return { title, body: body || cleaned };
  }

  // No TITLE line — treat the whole thing as the body.
  return { title: fallbackTitle(description), body: cleaned };
}
