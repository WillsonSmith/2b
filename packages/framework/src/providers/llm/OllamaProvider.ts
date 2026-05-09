import {
  Ollama,
  type Message as OllamaMessage,
  type Tool as OllamaTool,
} from "ollama";
import type { LLMProvider, ChatResponse } from "./LLMProvider.ts";
import type { ToolDefinition } from "../../core/Plugin.ts";
import type { Message } from "../../core/types.ts";
import { logger } from "../../logger.ts";
import { buildToolSystemPromptAddition } from "./StructuredToolCaller.ts";

export interface OllamaProviderOptions {
  /** How tools are called. "native" uses Ollama's built-in tool protocol.
   *  "structured_output" uses constrained JSON decoding — works with any model. */
  toolCallingStrategy?: "native" | "structured_output";
  /** Which embedding model to use with getEmbedding(). Defaults to "nomic-embed-text". */
  embeddingModel?: string;
  /**
   * Context window size in tokens passed as `num_ctx` to every request.
   * When omitted, Ollama automatically scales the context window based on
   * available system resources. Set explicitly to cap or guarantee a specific size.
   */
  numCtx?: number;
  /**
   * Enable thinking/reasoning for models that support it (e.g. deepseek-r1, qwq).
   * When true, Ollama returns reasoning in `message.thinking` separately from
   * `message.content`. Defaults to true.
   * Pass `"high" | "medium" | "low"` for models that accept a budget level instead
   * of a boolean (e.g. certain commercial models served through Ollama).
   */
  think?: boolean | "high" | "medium" | "low";
}

const STRUCTURED_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["tool_call", "message"] },
    tool: { type: "string" },
    args: { type: "object", additionalProperties: true },
    content: { type: "string" },
  },
  required: ["type"],
  additionalProperties: false,
} as const;

export class OllamaProvider implements LLMProvider {
  private client: Ollama;
  private toolCallingStrategy: "native" | "structured_output";
  private embeddingModel: string;
  private numCtx: number | undefined;
  private think: boolean | "high" | "medium" | "low";

  constructor(
    private model: string = "gemma3:4b",
    endpoint: string = "http://127.0.0.1:11434",
    options: OllamaProviderOptions = {},
  ) {
    this.client = new Ollama({ host: endpoint });
    this.toolCallingStrategy = options.toolCallingStrategy ?? "native";
    this.embeddingModel = options.embeddingModel ?? "nomic-embed-text";
    this.numCtx = options.numCtx;
    this.think = options.think ?? true;
  }

  async chat(
    messages: Message[],
    systemPrompt: string = "",
    _schema?: unknown,
    tools?: ToolDefinition[],
    onToken?: (token: string, isReasoning: boolean) => void,
    abortSignal?: AbortSignal,
  ): Promise<ChatResponse> {
    logger.info(
      "Ollama",
      `chat() model=${this.model} strategy=${this.toolCallingStrategy} tools=${tools?.length ?? 0} messages=${messages.length}`,
    );

    try {
      const hasTools = tools && tools.length > 0;
      const ollamaMessages: OllamaMessage[] = [];

      let effectiveSystemPrompt = systemPrompt;
      if (hasTools && this.toolCallingStrategy === "structured_output") {
        effectiveSystemPrompt = [
          systemPrompt,
          buildToolSystemPromptAddition(tools),
        ]
          .filter(Boolean)
          .join("\n\n");
      }

      if (effectiveSystemPrompt) {
        ollamaMessages.push({ role: "system", content: effectiveSystemPrompt });
      }
      for (const msg of messages) {
        ollamaMessages.push({ role: msg.role, content: msg.content });
      }

      if (hasTools && this.toolCallingStrategy === "native") {
        const ollamaTools: OllamaTool[] = tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as OllamaTool["function"]["parameters"],
          },
        }));
        return await this.actWithTools(
          ollamaMessages,
          ollamaTools,
          tools,
          onToken,
          abortSignal,
        );
      }

      if (hasTools && this.toolCallingStrategy === "structured_output") {
        const result = await this.callWithStructuredTools(
          ollamaMessages,
          tools,
          abortSignal,
        );
        return {
          response: result,
          nonReasoningContent: result,
          reasoningText: "",
        };
      }

      return await this.respond(ollamaMessages, onToken, abortSignal);
    } catch (error) {
      logger.error("Ollama", "Error communicating with Ollama server:", error);
      const msg =
        error instanceof Error
          ? `Ollama error: ${error.message}`
          : "I'm having trouble thinking right now. Is the Ollama server running?";
      onToken?.(msg, false);
      return { response: msg, nonReasoningContent: msg, reasoningText: "" };
    }
  }

  private async respond(
    messages: OllamaMessage[],
    onToken?: (token: string, isReasoning: boolean) => void,
    abortSignal?: AbortSignal,
  ): Promise<ChatResponse> {
    let reasoningText = "";
    let responseContent = "";

    const stream = await this.client.chat({
      model: this.model,
      messages,
      stream: true,
      think: this.think,
      ...(this.numCtx !== undefined
        ? { options: { num_ctx: this.numCtx } }
        : {}),
      ...(abortSignal !== undefined ? { signal: abortSignal } : {}),
    });

    for await (const chunk of stream) {
      // Ollama surfaces reasoning in `message.thinking` and the response in
      // `message.content` — two separate fields, no tag parsing required.
      if (chunk.message.thinking) {
        reasoningText += chunk.message.thinking;
        onToken?.(chunk.message.thinking, true);
      }
      if (chunk.message.content) {
        responseContent += chunk.message.content;
        onToken?.(chunk.message.content, false);
      }
    }

    return {
      response: responseContent || reasoningText,
      nonReasoningContent: responseContent,
      reasoningText,
    };
  }

  private async actWithTools(
    messages: OllamaMessage[],
    ollamaTools: OllamaTool[],
    tools: ToolDefinition[],
    onToken?: (token: string, isReasoning: boolean) => void,
    abortSignal?: AbortSignal,
  ): Promise<ChatResponse> {
    const MAX_ROUNDS = 100;
    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const history = [...messages];

    // Mirror abort state in a local flag via event listener.
    // In Bun's runtime, abortSignal.aborted may not reflect synchronously across
    // async boundaries when the abort originates from a different microtask context.
    // The "abort" event always fires eagerly, so the flag is visible on the next
    // synchronous check regardless of microtask ordering.
    let aborted = abortSignal?.aborted ?? false;
    const onAbort = () => { aborted = true; };
    abortSignal?.addEventListener("abort", onAbort);

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        if (aborted) {
          const msg = "Interrupted.";
          return { response: msg, nonReasoningContent: msg, reasoningText: "" };
        }
        // Stream to keep the connection alive during long tool executions.
        // We must collect silently — tool_calls only appear on the final chunk,
        // so we cannot know whether to emit tokens until the stream is complete.
        const stream = await this.client.chat({
          model: this.model,
          messages: history,
          tools: ollamaTools,
          stream: true,
          think: this.think,
          ...(this.numCtx !== undefined
            ? { options: { num_ctx: this.numCtx } }
            : {}),
          ...(abortSignal !== undefined ? { signal: abortSignal } : {}),
        });

        let roundThinking = "";
        let roundContent = "";
        let toolCalls: OllamaMessage["tool_calls"] | undefined;

        for await (const chunk of stream) {
          if (chunk.message.thinking) roundThinking += chunk.message.thinking;
          if (chunk.message.content) roundContent += chunk.message.content;
          if (chunk.message.tool_calls?.length) toolCalls = chunk.message.tool_calls;
        }

        if (aborted) {
          const msg = "Interrupted.";
          return { response: msg, nonReasoningContent: msg, reasoningText: "" };
        }

        if (!toolCalls || toolCalls.length === 0) {
          // Final round: emit what we collected and return directly.
          // Do NOT call respond() — re-invoking the model a second time was the
          // root cause of "shows thinking but no content" bugs in past fix attempts.
          logger.debug(
            "Ollama",
            `actWithTools() finished after ${round + 1} round(s)`,
          );
          if (roundThinking) onToken?.(roundThinking, true);
          if (roundContent) onToken?.(roundContent, false);
          return {
            response: roundContent || roundThinking,
            nonReasoningContent: roundContent,
            reasoningText: roundThinking,
          };
        }

        const assistantMsg: OllamaMessage = {
          role: "assistant",
          content: roundContent,
          thinking: roundThinking || undefined,
          tool_calls: toolCalls,
        };

        history.push(assistantMsg);

        logger.info(
          "Ollama",
          `Tool calls in round ${round + 1}: ${assistantMsg.tool_calls!.map((tc) => tc.function.name).join(", ")}`,
        );

        const toolResults = await Promise.all(
          assistantMsg.tool_calls!.map(async (tc) => {
            const tool = toolMap.get(tc.function.name);
            let result: string;

            if (!tool?.implementation) {
              result = `Tool "${tc.function.name}" not found or has no implementation.`;
              logger.warn("Ollama", result);
            } else if (aborted) {
              result = "Interrupted.";
            } else {
              try {
                logger.info(
                  "Ollama",
                  `Tool called by model: ${tc.function.name}`,
                  tc.function.arguments,
                );
                const raw = await tool.implementation(tc.function.arguments);
                result =
                  typeof raw === "string" ? raw : JSON.stringify(raw ?? null);
                logger.debug(
                  "Ollama",
                  `Tool result: ${tc.function.name}`,
                  result.slice(0, 200),
                );
              } catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                logger.error(
                  "Ollama",
                  `Tool threw: ${tc.function.name}: ${errMsg}`,
                );
                result = JSON.stringify({ error: errMsg });
              }
            }

            return { name: tc.function.name, result };
          }),
        );

        for (const { name, result } of toolResults) {
          history.push({
            role: "tool",
            tool_name: name,
            content: result,
          });
        }
      }
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
    }

    const msg = `Tool call loop reached the maximum of ${MAX_ROUNDS} rounds without a final response.`;
    logger.warn("Ollama", msg);
    return { response: msg, nonReasoningContent: msg, reasoningText: "" };
  }

  /**
   * Structured-output tool-calling loop for models without native tool support.
   * Uses Ollama's `format` parameter to constrain output to a JSON envelope,
   * mirroring the approach in `StructuredToolCaller` for LMStudio.
   */
  private async callWithStructuredTools(
    messages: OllamaMessage[],
    tools: ToolDefinition[],
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const MAX_ITERATIONS = 10;
    const toolMap = new Map(tools.map((t) => [t.name, t]));
    const history = [...messages];

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (abortSignal?.aborted) return "Interrupted.";
      const response = await this.client.chat({
        model: this.model,
        messages: history,
        format: STRUCTURED_RESPONSE_SCHEMA,
        stream: false,
        ...(this.numCtx !== undefined
          ? { options: { num_ctx: this.numCtx } }
          : {}),
        ...(abortSignal !== undefined ? { signal: abortSignal } : {}),
      });

      const content = response.message.content;

      let parsed: {
        type: string;
        tool?: string;
        args?: Record<string, unknown>;
        content?: string;
      };
      try {
        parsed = JSON.parse(content) as typeof parsed;
      } catch {
        return content;
      }

      if (parsed.type === "message") {
        return parsed.content ?? "";
      }

      if (parsed.type === "tool_call") {
        if (!parsed.tool) {
          history.push({
            role: "user",
            content: 'Tool error: response was missing the "tool" field.',
          });
          continue;
        }

        const tool = toolMap.get(parsed.tool);
        if (!tool?.implementation) {
          history.push({
            role: "user",
            content: `Tool "${parsed.tool}" not found or has no implementation.`,
          });
          continue;
        }

        let result: string;
        try {
          const raw = await tool.implementation(parsed.args ?? {});
          result = typeof raw === "string" ? raw : JSON.stringify(raw);
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          result = `Tool "${parsed.tool}" threw: ${errMsg}`;
        }

        history.push({ role: "assistant", content });
        history.push({
          role: "user",
          content: `Tool result for ${parsed.tool}: ${result}`,
        });
      } else {
        history.push({
          role: "user",
          content: `Unexpected response type "${parsed.type}". Respond with "tool_call" or "message".`,
        });
      }
    }

    throw new Error(
      `Ollama structured tool-call loop reached the maximum of ${MAX_ITERATIONS} iterations.`,
    );
  }

  public getModel(): string {
    return this.model;
  }

  public setModel(model: string): void {
    this.model = model;
  }

  // ~4 chars/token average; 1800 tokens leaves safe headroom below the 2048-token limit.
  // CortexMemoryDatabase.CHUNK_SIZE_CHARS (6000) must stay below this value so chunks
  // are never silently truncated here.
  private static readonly MAX_EMBEDDING_CHARS = 7200;

  public async getEmbedding(text: string): Promise<number[]> {
    const input =
      text.length > OllamaProvider.MAX_EMBEDDING_CHARS
        ? text.slice(0, OllamaProvider.MAX_EMBEDDING_CHARS)
        : text;
    const response = await this.client.embed({
      model: this.embeddingModel,
      input,
    });
    const embedding = response.embeddings[0];
    if (!embedding) throw new Error("Ollama returned no embedding vector");
    return embedding;
  }
}
