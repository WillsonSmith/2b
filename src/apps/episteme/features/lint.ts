import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

export interface LintIssue {
  text: string;
  suggestion: string;
  type: "clarity" | "conciseness" | "fluff";
}

const LINT_SYSTEM = `You are a writing quality checker. Analyze the document and return a JSON array of writing issues.

Each issue object must have exactly these fields:
- "text": the exact verbatim problematic phrase copied from the document (keep it short, 3-40 words)
- "suggestion": a concise 1-sentence improvement suggestion
- "type": one of "clarity", "conciseness", "fluff"

Types:
- clarity: sentences that are ambiguous, vague, or hard to follow
- conciseness: phrases that use more words than needed
- fluff: empty filler phrases ("very unique", "in order to", "it should be noted that", etc.)

Rules:
- Return at most 8 issues
- Only flag clear, high-confidence issues — not stylistic preferences
- The "text" field must be an exact substring of the input document
- Return ONLY the JSON array, no prose, no code fences
- If there are no issues, return []

Example: [{"text":"it is important to note that","suggestion":"Delete this filler — state the point directly","type":"fluff"}]`;

export class LintRunner {
  private agent: HeadlessAgent;
  private running = false;

  constructor(config: EpistemeConfig) {
    const llm = createProvider(featureModel(config, "linting"));
    this.agent = new HeadlessAgent(llm, [], LINT_SYSTEM, { agentName: "Linter" });
  }

  async run(docText: string): Promise<LintIssue[]> {
    if (this.running) return [];
    this.running = true;

    try {
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => {
          this.agent.interrupt();
          reject(new Error("lint timeout"));
        }, 8000),
      );

      const result = await Promise.race([
        this.agent.ask(`Check this document for writing issues:\n\n${docText.slice(0, 8000)}`),
        timeoutPromise,
      ]);

      return parseLintResult(result);
    } catch {
      return [];
    } finally {
      this.running = false;
    }
  }
}

function parseLintResult(raw: string): LintIssue[] {
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidIssue);
  } catch {
    return [];
  }
}

function isValidIssue(item: unknown): item is LintIssue {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as LintIssue).text === "string" &&
    (item as LintIssue).text.length > 0 &&
    typeof (item as LintIssue).suggestion === "string" &&
    ["clarity", "conciseness", "fluff"].includes((item as LintIssue).type)
  );
}
