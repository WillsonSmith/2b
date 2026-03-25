import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import type { LLMProvider } from "../../providers/llm/LLMProvider.ts";
import { WebSearchPlugin } from "../../plugins/WebSearchPlugin.ts";
import { WebReaderPlugin } from "../../plugins/WebReaderPlugin.ts";
import { WikipediaPlugin } from "../../plugins/WikipediaPlugin.ts";
import { RSSPlugin } from "../../plugins/RSSPlugin.ts";

export function createWebAgent(llm: LLMProvider): HeadlessAgent {
  return new HeadlessAgent(
    llm,
    [new WebSearchPlugin(), new WebReaderPlugin(), new WikipediaPlugin(), new RSSPlugin()],
    "You are a web research specialist. Use web search to find information, read web pages to extract detailed content, search Wikipedia for encyclopedic knowledge, and fetch RSS/Atom feeds for news and updates. Return well-organized factual summaries.",
  );
}
