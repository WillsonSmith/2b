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
import { InkPermissionManager } from "./InkPermissionManager.ts";
import { createMediaAgent } from "../../agents/sub-agents/createMediaAgent.ts";
import type { AgentPlugin, ToolDefinition } from "../../core/Plugin.ts";
import { ChatSession } from "../ChatSession.ts";
import { TerminalChat } from "./TerminalChat.tsx";
import { createFileSystemAgent } from "../../agents/sub-agents/createFileSystemAgent.ts";
import { createCodeReaderAgent } from "../../agents/sub-agents/createCodeReaderAgent.ts";
import { createInfoAgent } from "../../agents/sub-agents/createInfoAgent.ts";
import { ScratchPlugin } from "../../plugins/ScratchPlugin.ts";
import { RSSPlugin } from "../../plugins/RSSPlugin.ts";

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const modelFlag = args.indexOf("--model");
const modelArg = modelFlag !== -1 ? args[modelFlag + 1] : undefined;
const model = modelArg ?? process.env["MODEL"] ?? "qwen/qwen3.5-35b-a3b";

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

const permissionManager = new InkPermissionManager();

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
      "Use for any task involving video or audio: downloading clips from YouTube or Twitch, trimming or converting video files, extracting audio tracks, or analyzing the content of an image.",
    agent: createMediaAgent(llm, { permissionManager }),
  }),
);

agent.registerPlugin(
  new SubAgentPlugin({
    toolName: "info_agent",
    description:
      "Use for factual lookups only: movie and TV show details via TMDB, current weather for a location, or searching and reading Wikipedia articles. Does not write files or manage notes.",
    agent: createInfoAgent(llm, { permissionManager }),
  }),
);

agent.registerPlugin(
  new SubAgentPlugin({
    toolName: "file_system_agent",
    description:
      "Use for reading, writing, moving, copying, or deleting files and directories on the local filesystem. Also use for git inspection (log, status, diff, blame) and system state queries (disk usage, running processes). Use this to create notes — write them as markdown files (e.g. notes/my-note.md).",
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
      "Use when the user asks how this agent works, wants to trace a data flow, understand a plugin, or look up implementation details in this agent's own source code. Scoped only to this agent's source — not for exploring other projects or general coding tasks.",
    agent: createCodeReaderAgent({ sourceRoot }),
    // inactivityTimeoutMs: 30_000,
    // absoluteTimeoutMs: 300_000,
  }),
);
agent.registerPlugin(minimalToolsPlugin);
agent.registerPlugin(new ScratchPlugin());
agent.registerPlugin(new RSSPlugin());
agent.registerPlugin(
  new MemoryPlugin(llm, { cortexMemory: agent.memoryPlugin }),
);

// ── Start ─────────────────────────────────────────────────────────────────────

await agent.start();

const session = new ChatSession(agent);

render(
  <TerminalChat
    session={session}
    model={model}
    systemPrompt={systemPrompt}
    onModelChange={(newModel) => llm.setModel(newModel)}
    permissionManager={permissionManager}
  />,
);
