import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import type { LLMProvider } from "../../providers/llm/LLMProvider.ts";
import type { PermissionManager } from "../../core/PermissionManager.ts";
import { TMDBPlugin } from "../../plugins/TMDBPlugin.ts";
import { WeatherPlugin } from "../../plugins/WeatherPlugin.ts";
import { NotesPlugin } from "../../plugins/NotesPlugin.ts";

export interface InfoAgentOptions {
  permissionManager?: PermissionManager;
}

export function createInfoAgent(llm: LLMProvider, options: InfoAgentOptions = {}): HeadlessAgent {
  return new HeadlessAgent(
    llm,
    [new TMDBPlugin(), new WeatherPlugin(), new NotesPlugin()],
    "You are an information retrieval specialist. Look up movies, weather conditions, and create, list, read, and delete notes. Return concise, accurate information.",
    {
      agentName: "InfoAgent",
      permissionManager: options.permissionManager,
    },
  );
}
