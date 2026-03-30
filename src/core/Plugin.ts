import type { BaseAgent } from "./BaseAgent.ts";
import type { Message } from "./types.ts";
import type { PermissionLevel } from "./PermissionManager.ts";

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
   * Called after the LLM produces a response but before it is emitted as "speak".
   * Return a modified string to replace the response, or the original string to leave it unchanged.
   * Useful for routing to a vision model, a larger synthesis model, etc.
   */
  augmentResponse?: (response: string) => string | Promise<string>;
}
