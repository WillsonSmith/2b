import { HeadlessAgent } from "../../../core/HeadlessAgent.ts";
import { createProvider } from "../../../providers/llm/createProvider.ts";
import type { EpistemeConfig } from "../config.ts";
import { featureModel } from "../config.ts";

const AUTOCOMPLETE_SYSTEM = `You are an inline writing assistant. Continue the given text naturally. Return ONLY the continuation — no explanation, no repetition of the existing text. 3–15 words maximum.`;

/** Stateful autocomplete runner — reuse across requests to amortize provider setup. */
export class AutocompleteRunner {
  private agent: HeadlessAgent;

  constructor(config: EpistemeConfig) {
    const llm = createProvider(featureModel(config, "autocomplete"));
    this.agent = new HeadlessAgent(llm, [], AUTOCOMPLETE_SYSTEM, {
      agentName: "Autocomplete",
    });
  }

  async suggest(context: string): Promise<string> {
    const trimmed = context.slice(-1200); // keep last ~300 words of context
    return this.agent.ask(
      `Continue this text:\n\n${trimmed}`,
    );
  }

  interrupt(): void {
    this.agent.interrupt();
  }
}
