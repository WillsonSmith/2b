#!/usr/bin/env bun
/**
 * Terminal UI entry point for the 2b agent.
 *
 * Creates the agent without a CLIInputSource (Ink owns stdin) and wraps
 * it in a ChatSession, then renders the TerminalChat Ink app.
 *
 * Usage:
 *   bun src/ui/terminal/run.ts
 *   bun src/ui/terminal/run.ts --model google/gemma-3-4b
 */
import { render } from "ink";
import { CortexAgent } from "../../core/CortexAgent.ts";
import { LMStudioProvider } from "../../providers/llm/LMStudioProvider.ts";
import { MemoryPlugin } from "../../plugins/MemoryPlugin.ts";
import { SubAgentPlugin } from "../../plugins/SubAgentPlugin.ts";
import { AutoApprovePermissionManager } from "../../core/PermissionManager.ts";
import { createMediaAgent } from "../../agents/sub-agents/createMediaAgent.ts";
import type { AgentPlugin, ToolDefinition } from "../../core/Plugin.ts";
import { ChatSession } from "../ChatSession.ts";
import { TerminalChat } from "./TerminalChat.tsx";
import { createFileSystemAgent } from "../../agents/sub-agents/createFileSystemAgent.ts";
import { createCodeReaderAgent } from "../../agents/sub-agents/createCodeReaderAgent.ts";

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const modelFlag = args.indexOf("--model");
const modelArg = modelFlag !== -1 ? args[modelFlag + 1] : undefined;
const model = modelArg ?? process.env["MODEL"] ?? "nvidia/nemotron-3-nano-4b";

const lmStudioUrl = process.env["LM_STUDIO_URL"] ?? "ws://127.0.0.1:1234";

// ── Inline tools ──────────────────────────────────────────────────────────────

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
    implementation: (args: unknown) =>
      String((args as Record<string, unknown>)?.text ?? ""),
  },
];

const minimalToolsPlugin: AgentPlugin = {
  name: "MinimalTools",
  getTools: () => minimalTools,
};

// ── Build agent (no CLIInputSource — Ink owns stdin) ─────────────────────────

const llm = new LMStudioProvider(model, lmStudioUrl, {
  toolCallingStrategy: "native",
});

// AutoApprovePermissionManager is used here because InteractivePermissionManager
// reads from stdin, which conflicts with Ink's input handling.
// TODO: replace with an Ink-native permission dialog.
const permissionManager = new AutoApprovePermissionManager();

const systemPrompt =
  "You are a helpful assistant with access to tools. Think carefully before responding.\n\nWhen delegating to a sub-agent, always include in the task field all relevant context the sub-agent needs: usernames, URLs, IDs, dates, and any specific facts from memory. Sub-agents have no access to your memory or conversation history.";

const agent = new CortexAgent(llm, {
  name: "2b",
  cortexName: "2b",
  model,
  permissionManager,
  systemPrompt,
});

agent.registerPlugin(
  new SubAgentPlugin({
    toolName: "media_agent",
    description:
      "Handles media tasks: downloading videos, trimming clips, converting formats, extracting audio, and analyzing images.",
    agent: createMediaAgent(llm, { permissionManager }),
  }),
);
agent.registerPlugin(
  new SubAgentPlugin({
    toolName: "file_system_agent",
    description:
      "Handles file system operations: reading, writing, and managing directories.",
    agent: createFileSystemAgent(llm, { permissionManager }),
    inactivityTimeoutMs: 10_000,
    absoluteTimeoutMs: 10_000,
  }),
);
const sourceRoot = new URL("../..", import.meta.url).pathname;
agent.registerPlugin(
  new SubAgentPlugin({
    toolName: "explore_codebase",
    description:
      "Ask questions about the agent's own source code and get synthesized explanations. Use this to understand how the agent works, trace data flow, or look up implementation details. Example: 'How does tool_call flow through the system?' or 'What does MetacognitionPlugin track?'",
    agent: createCodeReaderAgent({ sourceRoot }),
    inactivityTimeoutMs: 30_000,
    absoluteTimeoutMs: 60_000,
  }),
);
agent.registerPlugin(minimalToolsPlugin);
agent.registerPlugin(new MemoryPlugin(llm));

// ── Start ─────────────────────────────────────────────────────────────────────

await agent.start();

const session = new ChatSession(agent);

render(
  <TerminalChat
    session={session}
    model={model}
    systemPrompt={systemPrompt}
    onModelChange={(newModel) => llm.setModel(newModel)}
  />,
);
