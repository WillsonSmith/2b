import type { Message } from "../../core/types.ts";
import type { ToolDefinition } from "../../core/Plugin.ts";

export interface ChatResponse {
  response: string;
  nonReasoningContent: string;
  reasoningText: string;
}

export interface LLMProvider {
  chat(
    messages: Message[] | any[],
    systemPrompt?: string,
    schema?: any,
    tools?: ToolDefinition[],
    onToken?: (token: string, isReasoning: boolean) => void,
  ): Promise<ChatResponse>;

  getEmbedding(text: string): Promise<number[]>;
}
