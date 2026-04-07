import { CortexAgent } from "../core/CortexAgent.ts";
import { createProvider } from "../providers/llm/createProvider.ts";
import { MemoryPlugin } from "../plugins/MemoryPlugin.ts";
import { SubAgentPlugin } from "../plugins/SubAgentPlugin.ts";
import { CLIInputSource } from "./input-sources/CLIInputSource.ts";
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import {
  InteractivePermissionManager,
  SessionCache,
} from "../core/PermissionManager.ts";
import { createMediaAgent } from "./sub-agents/createMediaAgent.ts";
import { createFileSystemAgent } from "./sub-agents/createFileSystemAgent.ts";
import { createCodeReaderAgent } from "./sub-agents/createCodeReaderAgent.ts";

// ── Inline tools ─────────────────────────────────────────────────────────────

const minimalTools: ToolDefinition[] = [
  {
    name: "get_current_time",
    description: "Returns the current local date and time.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
    implementation: () => new Date().toLocaleString(),
  },
  {
    name: "echo",
    description: "Echoes the given text back.",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    implementation: (args: unknown) => {
      const text = (args as Record<string, unknown>)?.text;
      if (typeof text !== "string") {
        console.warn(
          "[MinimalTools] echo: expected string for 'text', got",
          typeof text,
          "— coercing",
        );
        return String(text ?? "");
      }
      return text;
    },
  },
];

const minimalToolsPlugin: AgentPlugin = {
  name: "MinimalTools",
  getTools: () => minimalTools,
};

// ── Factory ───────────────────────────────────────────────────────────────────

export interface CreateAgentResult {
  agent: CortexAgent;
  input: CLIInputSource;
}

export function createAgent(
  model?: string,
): CreateAgentResult {
  const resolvedModel = model ?? process.env.MODEL ?? "qwen/qwen3.5-35b-a3b";
  if (!resolvedModel) throw new Error("MODEL env var is set but empty");
  const llm = createProvider(resolvedModel);

  const sessionCache = new SessionCache();
  const permissionManager = new InteractivePermissionManager({
    timeoutMs: 30_000,
    cache: sessionCache,
  });

  const agent = new CortexAgent(llm, {
    name: "2b",
    cortexName: "2b",
    model: resolvedModel,
    permissionManager,
    // TODO(SubAgentPlugin): The context instruction below is prompt-based only and not
    // structurally enforced. Move to automatic context injection in SubAgentPlugin for
    // reliability across model updates.
    systemPrompt:
      "You are a helpful assistant with access to tools. Think carefully before responding.\n\nWhen delegating to a sub-agent, always include in the task field all relevant context the sub-agent needs: usernames, URLs, IDs, dates, and any specific facts from memory. Sub-agents have no access to your memory or conversation history.",
  });

  const input = new CLIInputSource();

  agent.registerPlugin(
    new SubAgentPlugin({
      toolName: "media_agent",
      description:
        "Handles media tasks: downloading videos, trimming clips, converting formats, extracting audio, and analyzing images.",
      agent: createMediaAgent(llm, { permissionManager }),
      // intentionally no timeout — downloads and transcodes can take arbitrarily long
    }),
  );

  agent.registerPlugin(
    new SubAgentPlugin({
      toolName: "file_system_agent",
      description:
        "Handles file system operations: reading, writing, and managing directories.",
      agent: createFileSystemAgent(llm, { permissionManager }),
      // No absoluteTimeoutMs — FileSystemPlugin enforces per-op timeouts internally.
      // An absolute cap would kill legitimate long-running sequences (e.g. writing many files).
    }),
  );
  const sourceRoot = new URL("../..", import.meta.url).pathname;
  agent.registerPlugin(
    new SubAgentPlugin({
      toolName: "explore_codebase",
      description:
        "Ask questions about the agent's own source code and get synthesized explanations. Use this to understand how the agent works, trace data flow, or look up implementation details. Example: 'How does tool_call flow through the system?' or 'What does MetacognitionPlugin track?'",
      agent: createCodeReaderAgent(llm, { sourceRoot }),
      inactivityTimeoutMs: 30_000,
      absoluteTimeoutMs: 60_000,
    }),
  );

  agent.registerPlugin(minimalToolsPlugin);
  agent.registerPlugin(
    new MemoryPlugin(llm, { cortexMemory: agent.memoryPlugin }),
  );
  agent.addInputSource(input);

  return { agent, input };
}
