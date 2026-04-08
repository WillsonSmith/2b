import type { LLMProvider, ChatResponse } from "./LLMProvider.ts";
import type { ToolDefinition } from "../../core/Plugin.ts";
import type { Message } from "../../core/types.ts";
import { getModelCapabilities } from "./modelCapabilities.ts";

type ProviderWithModelControl = LLMProvider & {
  setModel?(model: string): void;
  getModel?(): string;
};

/**
 * Decorator that wraps any LLMProvider and applies model-specific capabilities
 * (e.g. system prompt prefixes) transparently on every `chat()` call.
 *
 * This keeps the capability registry and injection logic in one place so that
 * new providers need no knowledge of model quirks.
 */
export class ModelCapabilityProvider implements LLMProvider {
  constructor(
    private readonly inner: ProviderWithModelControl,
    private model: string,
  ) {}

  async chat(
    messages: Message[],
    systemPrompt?: string,
    schema?: unknown,
    tools?: ToolDefinition[],
    onToken?: (token: string, isReasoning: boolean) => void,
  ): Promise<ChatResponse> {
    const { systemPromptPrefix } = getModelCapabilities(this.model);
    const effectivePrompt =
      systemPromptPrefix && systemPrompt !== undefined
        ? `${systemPromptPrefix}${systemPrompt}`
        : systemPromptPrefix
          ? systemPromptPrefix
          : systemPrompt;

    return this.inner.chat(messages, effectivePrompt, schema, tools, onToken);
  }

  getEmbedding(text: string): Promise<number[]> {
    return this.inner.getEmbedding(text);
  }

  setModel(model: string): void {
    this.model = model;
    this.inner.setModel?.(model);
  }

  getModel(): string {
    return this.model;
  }
}
