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
import type { InputSource } from "./InputSource.ts";
import type { Message, VerificationResult } from "./types.ts";
import type { PermissionLevel } from "./PermissionManager.ts";

/**
 * Retry policy for automatic tool-level retries on transient failures.
 *
 * `maxAttempts` is the total number of attempts including the first call (so
 * `maxAttempts: 3` means one initial call plus two retries).
 *
 * `retryOn` is an optional predicate called with the thrown error. When omitted
 * every thrown error triggers a retry. When provided, only errors for which it
 * returns `true` are retried — all other errors are returned immediately.
 */
export interface RetryPolicy {
  maxAttempts: number;
  delayMs?: number;
  backoff?: "fixed" | "exponential";
  retryOn?: (error: unknown) => boolean;
}

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
  /**
   * Optional automatic retry policy. When set, BaseAgent retries the tool call on
   * thrown errors up to `maxAttempts` times total before returning an error string.
   * Applied before `verifyAfter`.
   */
  retry?: RetryPolicy;
  /**
   * Optional post-execution verification hook. Called by BaseAgent after a successful
   * tool execution. If the returned VerificationResult has `passed: false`, BaseAgent
   * appends a `[Verification failed: <message>]` suffix to the tool result string sent
   * to the LLM and emits a "log" event. Errors thrown by this hook are swallowed and
   * logged but do not fail the tool call.
   */
  verifyAfter?: (args: Record<string, unknown>, result: unknown) => Promise<VerificationResult>;
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
  /**
   * Called during agent.start(), after all onInit() hooks have completed.
   * Return InputSource instances to register with the agent. Sources returned here
   * are started alongside any sources added directly via agent.addInputSource().
   *
   * This is the hook that allows plugins to contribute reactive input channels
   * (e.g. a webhook listener, a file watcher, a socket connection) without
   * requiring the orchestrator to know about them at construction time.
   */
  createInputSources?: (agent: BaseAgent) => InputSource[] | Promise<InputSource[]>;
}
