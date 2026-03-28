import type { Message } from "../../core/types.ts";
import type { ToolDefinition } from "../../core/Plugin.ts";

/** The response returned by a single LLM `chat` call. */
export interface ChatResponse {
  /**
   * The full final text produced by the model for this turn.
   * When tool calls occur this is the assistant message captured after all
   * tool rounds complete; it may include reasoning tokens depending on the
   * model.
   */
  response: string;
  /**
   * The non-reasoning portion of the final response only.
   * Strips out chain-of-thought / reasoning tokens so callers always get
   * clean prose, regardless of whether the model emits a reasoning prefix.
   */
  nonReasoningContent: string;
  /** Raw reasoning / chain-of-thought text emitted by the model, if any. */
  reasoningText: string;
}

/**
 * Abstraction over a language-model backend.
 * Implement this interface to add support for a new LLM provider.
 */
export interface LLMProvider {
  /**
   * Send a conversation to the model and return its response.
   *
   * @param messages - Ordered conversation history.
   * @param systemPrompt - Optional system-level instruction prepended to the
   *   conversation.
   * @param schema - Optional structured-output schema passed to the provider.
   *   The concrete type is provider-specific; callers that do not need
   *   structured output should pass `undefined`.
   * @param tools - Tool definitions the model may call during this turn.
   * @param onToken - Optional streaming callback invoked for each token as it
   *   is produced. `isReasoning` is `true` while the model is in its
   *   chain-of-thought phase.
   */
  chat(
    messages: Message[],
    systemPrompt?: string,
    schema?: unknown,
    tools?: ToolDefinition[],
    onToken?: (token: string, isReasoning: boolean) => void,
  ): Promise<ChatResponse>;

  /**
   * Return a vector embedding for the given text.
   *
   * @param text - The input string to embed. Behaviour on empty strings or
   *   strings that exceed the model's context window is implementation-defined;
   *   implementors should throw a descriptive `Error` in those cases.
   * @throws {Error} If the embedding model is unavailable or the request
   *   fails.
   */
  getEmbedding(text: string): Promise<number[]>;
}
