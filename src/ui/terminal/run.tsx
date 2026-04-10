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
import { createProvider, defaultModel } from "../../providers/llm/createProvider.ts";
import { MemoryPlugin } from "../../plugins/MemoryPlugin.ts";
import { SubAgentPlugin } from "../../plugins/SubAgentPlugin.ts";
import { InkPermissionManager } from "./InkPermissionManager.ts";
import type { AgentPlugin, ToolDefinition } from "../../core/Plugin.ts";
import { ChatSession } from "../ChatSession.ts";
import { TerminalChat } from "./TerminalChat.tsx";
import { createCodeReaderAgent } from "../../agents/sub-agents/createCodeReaderAgent.ts";
import { ScratchPlugin } from "../../plugins/ScratchPlugin.ts";
import { RSSPlugin } from "../../plugins/RSSPlugin.ts";
import { DynamicAgentPlugin } from "../../plugins/DynamicAgentPlugin.ts";

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const modelFlag = args.indexOf("--model");
const modelArg = modelFlag !== -1 ? args[modelFlag + 1] : undefined;
const model = modelArg ?? process.env["MODEL"] ?? defaultModel();

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

const llm = createProvider(model);

const permissionManager = new InkPermissionManager();

const systemPrompt = [
  "You are a helpful assistant with access to tools. Think carefully before responding.",
  "",
  "Sub-agents: Several specialized agents are pre-created and available immediately via call_agent.",
  "Use list_agents to see what exists. Use list_capabilities to see what plugins are available when creating new agents.",
  "When calling any agent, include all relevant context it needs in the task field — agents have no access to your memory or conversation history.",
  "Prefer an existing agent for its domain. Create a new one only when the task requires a focus or capability set that doesn't match any existing agent.",
  'Use "headless" for isolated one-shot tasks. Use "cortex" when the agent needs to remember context across multiple calls.',
  "",
  "The explore_codebase tool is separate — use it to read and understand this agent's own source code.",
].join("\n");

const agent = new CortexAgent(llm, {
  name: "2b",
  cortexName: "2b",
  model,
  permissionManager,
  systemPrompt,
});

// explore_codebase is kept as a static SubAgentPlugin because createCodeReaderAgent
// instantiates its own LLMProvider with a code-specific model — this can't be
// replicated through the generic capability system.
const sourceRoot = new URL("../..", import.meta.url).pathname;
agent.registerPlugin(
  new SubAgentPlugin({
    toolName: "explore_codebase",
    description:
      "Use when the user asks how this agent works, wants to trace a data flow, understand a plugin, or look up implementation details in this agent's own source code. Scoped only to this agent's source — not for exploring other projects or general coding tasks.",
    agent: createCodeReaderAgent(llm, { sourceRoot }),
  }),
);

agent.registerPlugin(
  new DynamicAgentPlugin(llm, {
    permissionManager,
    model,
    sourceRoot,
    presets: {
      media: {
        system_prompt:
          "You are a media processing specialist. You can download video clips from URLs, trim and convert video files, extract audio tracks, and analyze images from URLs or local file paths. Verify file paths before editing and prefer non-destructive operations where possible.",
        capabilities: ["media", "image_vision", "download"],
      },
      info: {
        system_prompt:
          "You are an information retrieval specialist. Look up movies and TV shows via TMDB, check current weather for a location, and search or read Wikipedia articles. Return concise, accurate information.",
        capabilities: ["tmdb", "weather", "wikipedia"],
      },
      filesystem: {
        system_prompt: [
          "You are a file system agent. Your job is to read, write, and manage files and directories on the local filesystem, and to inspect git history and system state.",
          "",
          "File guidelines:",
          "- Use list_directory or find_files to locate files before reading or modifying them.",
          "- Use stat_file to check whether a file exists and get its size before reading large files.",
          "- Use read_file with offset and limit for files larger than 1 MB.",
          "- Use write_file for new files or full overwrites; use append_file to add to existing content.",
          "- Use move_file to rename or relocate; use copy_file to duplicate.",
          "- Use delete_file only when explicitly instructed — deletions are permanent.",
          "- Paths can be absolute or relative to the working directory.",
          "- Return structured results: always include the resolved path and any relevant metadata (size, line count, etc.).",
          "",
          "Shell guidelines:",
          "- Use run_shell for git inspection (log, status, diff, blame, show) and system queries (df, du, ps, whoami).",
          "- Prefer FileSystem tools over shell equivalents for reading and searching files — they return structured data and handle large files safely.",
          "- Always check exitCode in run_shell results — a non-zero exit means the command failed.",
          "",
          "Notes:",
          "- Store notes as markdown files under notes/ (e.g. notes/my-note.md). Create the directory if it does not exist.",
          "- To list notes: use list_directory on the notes/ directory.",
          "- To read a note: use read_file on the relevant notes/*.md file.",
          "- To delete a note: use delete_file on the relevant notes/*.md file.",
        ].join("\n"),
        capabilities: ["files", "shell"],
      },
    },
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
