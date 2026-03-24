import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import type { LLMProvider } from "../../providers/llm/LLMProvider.ts";
import { TMDBPlugin } from "../../plugins/TMDBPlugin.ts";
import { WeatherPlugin } from "../../plugins/WeatherPlugin.ts";
import { NotesPlugin } from "../../plugins/NotesPlugin.ts";

export function createInfoAgent(llm: LLMProvider): HeadlessAgent {
  return new HeadlessAgent(
    llm,
    [new TMDBPlugin(), new WeatherPlugin(), new NotesPlugin()],
    "You are an information retrieval specialist. Look up movies, weather conditions, and manage notes. Return concise, accurate information.",
  );
}
