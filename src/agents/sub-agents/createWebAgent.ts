import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import type { LLMProvider } from "../../providers/llm/LLMProvider.ts";
import { WebSearchPlugin } from "../../plugins/WebSearchPlugin.ts";
import { WebReaderPlugin } from "../../plugins/WebReaderPlugin.ts";
import { WikipediaPlugin } from "../../plugins/WikipediaPlugin.ts";

export function createWebAgent(llm: LLMProvider): HeadlessAgent {
  return new HeadlessAgent(
    llm,
    [new WebSearchPlugin(), new WebReaderPlugin(), new WikipediaPlugin()],
    "You are a web research specialist. Use web search to find information, read web pages to extract detailed content, and search Wikipedia for encyclopedic knowledge. Return well-organized factual summaries.",
  );
}
