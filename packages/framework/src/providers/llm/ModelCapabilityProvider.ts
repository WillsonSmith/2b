/**
 * ModelCapabilityProvider — transparent decorator over any LLMProvider.
 *
 * Intercepts every `chat()` call to prepend a model-specific system prompt
 * prefix (e.g. thinking-mode headers required by some models) before forwarding
 * to the inner provider.
 *
 * Also surfaces `setModel` / `getModel` so the UI can hot-swap the active model
 * without reconstructing the agent.
 *
 * Critical: all inference goes through this class. Adding a new capability
 * (e.g. per-model max-tokens injection) belongs here.
 */
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
    // Build the effective system prompt: prefix takes precedence over a missing
    // base prompt, but is always prepended when both are present.
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
