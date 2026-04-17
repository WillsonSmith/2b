/**
 * Core plugin interface for the 2b agent framework.
 *
 * Every capability the agent has beyond raw LLM inference is delivered through a
 * plugin. Plugins can contribute any combination of:
 *   - Tools the LLM can invoke (`getTools` / `executeTool`)
 *   - Persistent system-prompt context (`getSystemPromptFragment`)
 *   - Per-turn injected context (`getContext`)
 *   - Conversation history (`getMessages`)
 *   - Side effects on each message (`onMessage`)
 *   - Pre-tool guards (`onBeforeToolCall`)
 *   - Post-response transformations (`augmentResponse`)
 *
 * All plugin hooks are called inside try-catch by BaseAgent — a throwing plugin
 * never crashes the agent.
 *
 * Critical: this file is the contract every plugin must satisfy. Changing these
 * interfaces is a breaking change for all plugins.
 */
import type { BaseAgent } from "./BaseAgent.ts";
import type { Message } from "./types.ts";
import type { PermissionLevel } from "./PermissionManager.ts";

/**
 * Describes a single callable tool that the LLM can invoke.
 *
 * If `implementation` is provided, BaseAgent calls it directly (used for inline
 * tools in 2b.ts). If omitted, the call is routed to `executeTool` on the plugin
 * that returned this definition from `getTools()`.
 *
 * `permission` controls whether the user must approve each call:
 *   - "none"      — always auto-approved (default)
 *   - "per_call"  — user approves each invocation
 *   - "session"   — user approves once; subsequent calls in the session are auto-approved
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  implementation?: (args: any) => any | Promise<any>;
  /** Whether this tool requires user approval before execution. Default: "none". */
  permission?: PermissionLevel;
}

export interface AgentPlugin {
  name: string;
  onInit?: (agent: BaseAgent) => void | Promise<void>;
  /**
   * Return a string injected directly into the agent system prompt.
   * @param context - The joined input text for the current turn, used for semantic retrieval.
   */
  getSystemPromptFragment?: (context?: string) => string | Promise<string>;
  /**
   * Return a string of context to inject into the current turn.
   * @param currentEvents - The raw input strings for the current turn.
   */
  getContext?: (currentEvents?: string[]) => string | Promise<string>;
  getTools?: () => ToolDefinition[];
  executeTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onMessage?: (
    role: Message["role"],
    content: string,
    source: string,
  ) => void | Promise<void>;
  getMessages?: (limit?: number) => Message[] | Promise<Message[]>;
  onError?: (error: Error) => void;
  /**
   * Called before a tool's implementation is invoked. Return `{ allow: true }` to proceed
   * normally, or `{ allow: false, reason }` to block the call. The reason string is returned
   * to the LLM as the tool result so it can adapt its behaviour.
   */
  onBeforeToolCall?: (
    name: string,
    args: Record<string, unknown>,
  ) => { allow: true } | { allow: false; reason: string };
  /**
   * Called after the LLM produces a response but before it is emitted as "speak".
   * Return a modified string to replace the response, or the original string to leave it unchanged.
   * Useful for routing to a vision model, a larger synthesis model, etc.
   */
  augmentResponse?: (response: string) => string | Promise<string>;
}
