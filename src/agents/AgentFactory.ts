import { CortexAgent } from "../core/CortexAgent.ts";
import { LMStudioProvider } from "../providers/llm/LMStudioProvider.ts";
import { MemoryPlugin } from "../plugins/MemoryPlugin.ts";
import { SubAgentPlugin } from "../plugins/SubAgentPlugin.ts";
import { CLIInputSource } from "./input-sources/CLIInputSource.ts";
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { createMediaAgent } from "./sub-agents/createMediaAgent.ts";
import { createWebAgent } from "./sub-agents/createWebAgent.ts";
import { createSystemAgent } from "./sub-agents/createSystemAgent.ts";
import { createInfoAgent } from "./sub-agents/createInfoAgent.ts";

// ── Inline tools plugin ───────────────────────────────────────────────────────

class MinimalToolsPlugin implements AgentPlugin {
  name = "MinimalTools";

  getTools(): ToolDefinition[] {
    return [
      {
        name: "get_current_time",
        description: "Returns the current local date and time.",
        parameters: { type: "object", properties: {} },
        implementation: () => new Date().toString(),
      },
      {
        name: "echo",
        description:
          "Echoes text back. Useful for confirming what the agent heard.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        implementation: ({ text }: { text: string }) => text,
      },
    ];
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createAgent(): {
  agent: CortexAgent;
  input: CLIInputSource;
} {
  const model = process.env.MODEL ?? "nvidia/nemotron-3-nano-4b";
  const lmStudioUrl = process.env.LM_STUDIO_URL ?? "http://127.0.0.1:1234";
  const llm = new LMStudioProvider(model, lmStudioUrl, {
    toolCallingStrategy: "native",
  });

  const agent = new CortexAgent(llm, {
    name: "2b",
    cortexName: "2b",
    model,
    systemPrompt:
      "You are a helpful assistant with access to tools. Think carefully before responding.\n\nWhen delegating to a sub-agent, always include in the task field all relevant context the sub-agent needs: usernames, URLs, IDs, dates, and any specific facts from memory. Sub-agents have no access to your memory or conversation history.",
  });

  const input = new CLIInputSource();

  agent.registerPlugin(
    new SubAgentPlugin({
      toolName: "media_agent",
      description:
        "Handles media tasks: downloading videos, trimming clips, converting formats, extracting audio, and analyzing images.",
      agent: createMediaAgent(llm),
      // No timeouts — downloads and transcodes can take arbitrarily long.
    }),
  );
  agent.registerPlugin(
    new SubAgentPlugin({
      toolName: "web_agent",
      description:
        "Handles web research: searching the web and reading web page content.",
      agent: createWebAgent(llm),
      inactivityTimeoutMs: 60_000,
      absoluteTimeoutMs: 120_000,
    }),
  );
  agent.registerPlugin(
    new SubAgentPlugin({
      toolName: "system_agent",
      description:
        "Handles system operations: running shell commands, reading/writing files, clipboard access, and executing sandboxed code.",
      agent: createSystemAgent(llm),
      inactivityTimeoutMs: 30_000,
      absoluteTimeoutMs: 120_000,
    }),
  );
  agent.registerPlugin(
    new SubAgentPlugin({
      toolName: "info_agent",
      description:
        "Handles information lookup: movies via TMDB, weather conditions, and personal notes management.",
      agent: createInfoAgent(llm),
      inactivityTimeoutMs: 15_000,
      absoluteTimeoutMs: 30_000,
    }),
  );
  agent.registerPlugin(new MinimalToolsPlugin());
  agent.registerPlugin(new MemoryPlugin(llm));
  agent.addInputSource(input);

  return { agent, input };
}
