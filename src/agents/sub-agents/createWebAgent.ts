import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import type { LLMProvider } from "../../providers/llm/LLMProvider.ts";
import { WebSearchPlugin } from "../../plugins/WebSearchPlugin.ts";
import { WebReaderPlugin } from "../../plugins/WebReaderPlugin.ts";

export function createWebAgent(llm: LLMProvider): HeadlessAgent {
  return new HeadlessAgent(
    llm,
    [new WebSearchPlugin(), new WebReaderPlugin()],
    "You are a web research specialist. Use web search to find information and read web pages to extract detailed content. Return well-organized factual summaries.",
  );
}
