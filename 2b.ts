#!/usr/bin/env bun
/**
 * Entry point for the 2b agent.
 *
 * Parses CLI flags, constructs the LLM provider and CortexAgent, registers all
 * plugins in dependency order, then delegates to either the terminal or web UI.
 *
 * Depends on:
 *   - MODEL env var (overridden by --model flag) — LMStudio model identifier
 *   - PORT env var (overridden by --port flag) — web UI port, default 3000
 *   - DEBUG_TOKENS env var or --debug-tokens flag — streams raw tokens to stdout
 *
 * Critical: this is the only file that wires the agent together. Plugin
 * registration order is largely free — `agent.memoryPlugin` is the
 * CortexMemoryPlugin created inside CortexAgent's constructor and is available
 * immediately, before any external plugin is registered.
 *
 * Usage:
 *   bun 2b.ts
 *   bun 2b.ts --model google/gemma-3-4b
 *   bun 2b.ts --web
 *   bun 2b.ts --web --port 8080
 */
import { CortexAgent } from "./src/core/CortexAgent.ts";
import {
  createProvider,
  defaultModel,
} from "./src/providers/llm/createProvider.ts";
import { MemoryPlugin } from "./src/plugins/MemoryPlugin.ts";
import { SubAgentPlugin } from "./src/plugins/SubAgentPlugin.ts";
import { InkPermissionManager } from "./src/ui/terminal/InkPermissionManager.ts";
import { WebPermissionManager } from "./src/ui/web/WebPermissionManager.ts";
import type { AgentPlugin, ToolDefinition } from "./src/core/Plugin.ts";
import { createCodebaseExplainerAgent } from "./src/agents/sub-agents/createCodebaseExplainerAgent.ts";
import { ScratchPlugin } from "./src/plugins/ScratchPlugin.ts";
import { DynamicAgentPlugin } from "./src/plugins/DynamicAgentPlugin.ts";
import { FileSystemPlugin } from "./src/plugins/FileSystemPlugin.ts";
import { ShellPlugin } from "./src/plugins/ShellPlugin.ts";
import { startTerminalUI } from "./src/ui/terminal/run.tsx";
import { startWebUI } from "./src/ui/web/server.ts";

// ── Parse CLI args ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const modelFlag = args.indexOf("--model");
const modelArg = modelFlag !== -1 ? args[modelFlag + 1] : undefined;
const model = modelArg ?? process.env["MODEL"] ?? defaultModel();

const useWeb = args.includes("--web");
const portFlag = args.indexOf("--port");
const portArg = portFlag !== -1 ? Number(args[portFlag + 1]) : undefined;
const port =
  portArg ?? (process.env["PORT"] ? Number(process.env["PORT"]) : 3000);

const debugTokens =
  args.includes("--debug-tokens") || process.env["DEBUG_TOKENS"] === "1";
// When set, this callback is passed to providers / sub-agents so raw LLM tokens
// stream to stdout as they arrive — useful for debugging slow or looping agents.
const debugTokenCallback = debugTokens
  ? (token: string, isReasoning: boolean) => {
      // Gray for reasoning, plain for response tokens
      process.stdout.write(isReasoning ? `\x1b[90m${token}\x1b[0m` : token);
    }
  : undefined;

// ── Inline tools ──────────────────────────────────────────────────────────────
// These trivial utilities don't warrant their own plugin file. ToolDefinition
// supports an `implementation` field so they can be registered as a bare plugin
// object without subclassing. All other tools live in dedicated plugin files.

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

// ── Build agent ───────────────────────────────────────────────────────────────

const llm = createProvider(model);

// PermissionManager implementation is chosen by UI mode. WebPermissionManager
// sends approval requests over SSE; InkPermissionManager renders an Ink prompt
// inline in the terminal. Both implement the same PermissionManager interface.
const permissionManager = useWeb
  ? new WebPermissionManager()
  : new InkPermissionManager();

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
  "",
  "Multi-turn tasks: When the user gives you a task that spans multiple turns (e.g. 'ask me questions about X for 20 turns', 'work through this list one item at a time'), call set_active_goal immediately with a description of the task and any progress tracking. This pins the goal into every system prompt for the session so it survives message summarization. Call clear_active_goal when the task is finished.",
].join("\n");

const agent = new CortexAgent(llm, {
  name: "2b",
  cortexName: "2b",
  model,
  permissionManager,
  systemPrompt,
});

// Resolve the absolute path to src/ relative to this entry file so the
// codebase-explainer and DynamicAgentPlugin can scope file access correctly
// regardless of the working directory from which `bun 2b.ts` is invoked.
const sourceRoot = new URL("src/", import.meta.url).pathname;

agent.registerPlugin(
  new SubAgentPlugin({
    toolName: "explore_codebase",
    description:
      "Use when the user asks how this agent works, wants to trace a data flow, understand a plugin, or look up implementation details in this agent's own source code. Scoped only to this agent's source — not for exploring other projects or general coding tasks.",
    agent: createCodebaseExplainerAgent(llm, {
      sourceRoot,
      onToken: debugTokenCallback,
    }),
  }),
);

agent.registerPlugin(
  new DynamicAgentPlugin(llm, {
    permissionManager,
    model,
    sourceRoot,
    parentMemory: agent.memoryPlugin,
    presets: {
      media: {
        system_prompt:
          "You are a media processing specialist. You can download video clips from URLs, trim and convert video files, extract audio tracks, and analyze images from URLs or local file paths. Verify file paths before editing and prefer non-destructive operations where possible.",
        capabilities: ["media", "image_vision", "download"],
      },
      info: {
        system_prompt:
          "You are an information retrieval specialist. Look up movies and TV shows via TMDB, check current weather for a location, search or read Wikipedia articles, and fetch RSS/Atom feeds. Return concise, accurate information.",
        capabilities: ["tmdb", "weather", "wikipedia", "rss"],
      },
      coder: {
        system_prompt:
          "You are a senior TypeScript engineer. You write clean, correct, idiomatic TypeScript and execute it yourself using execute_typescript.\n\nWhen given a coding task:\n- Write the code directly — do not describe what you would write, just write it.\n- Prefer Bun APIs (Bun.file, bun:sqlite, Bun.serve, etc.) over Node.js equivalents.\n- Use TypeScript types properly. Avoid `any`.\n- No unnecessary abstractions. Solve the problem directly.\n- If something fails, read the error and fix it.\n\nSandbox constraints: no npm packages (Bun built-ins only), no network, no host filesystem.\nInput: `const data = JSON.parse(process.env.INPUT_DATA ?? 'null');`\nOutput: `console.log(...)`",
        capabilities: ["bun_sandbox", "files", "scratch"],
      },
    },
  }),
);

agent.registerPlugin(new FileSystemPlugin());
agent.registerPlugin(new ShellPlugin());
agent.registerPlugin(minimalToolsPlugin);
agent.registerPlugin(new ScratchPlugin());
agent.registerPlugin(
  new MemoryPlugin(llm),
);

// ── Start ─────────────────────────────────────────────────────────────────────

if (useWeb) {
  await startWebUI({
    agent,
    model,
    systemPrompt,
    permissionManager: permissionManager as WebPermissionManager,
    onModelChange: (newModel) => llm.setModel(newModel),
    port,
  });
} else {
  await startTerminalUI({
    agent,
    model,
    systemPrompt,
    permissionManager: permissionManager as InkPermissionManager,
    // onModelChange lets the UI swap the model at runtime without restarting
    // the agent — the provider holds the current model string and updates it.
    onModelChange: (newModel) => llm.setModel(newModel),
  });
}
