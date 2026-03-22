import type { BaseAgent } from "./BaseAgent.ts";
import type { Message } from "./types.ts";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any; // JSON Schema
  implementation?: (args: any) => any | Promise<any>;
}

export interface AgentPlugin {
  name: string;
  onInit?: (agent: BaseAgent) => void;
  /** Return a string injected directly into the agent system prompt. */
  getSystemPromptFragment?: () => string;
  getContext?: (currentEvents?: string[]) => string | Promise<string>;
  getTools?: () => ToolDefinition[];
  executeTool?: (name: string, args: any) => any | Promise<any>;
  onMessage?: (
    role: "user" | "assistant" | "system",
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
