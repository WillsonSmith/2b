import type { ToolDefinition } from "../../core/Plugin.ts";
import type { LLMProvider, ChatResponse } from "./LLMProvider.ts";
import type { Message } from "../../core/types.ts";
import { logger } from "../../logger.ts";
import {
  LMStudioClient,
  Chat,
  rawFunctionTool,
  type Tool,
  type ChatLike,
  type ChatMessage,
  type LLMDynamicHandle,
  type LLMPredictionFragmentWithRoundIndex,
  type LLMStructuredPredictionSetting,
  type ToolCallRequestError,
  type PredictionResult,
} from "@lmstudio/sdk";
import {
  callWithStructuredTools,
  buildToolSystemPromptAddition,
} from "./StructuredToolCaller.ts";

export interface LMStudioProviderOptions {
  /** How tools are called. "native" uses the model's tool protocol (requires model support).
   *  "structured_output" uses constrained JSON decoding — works with any model. */
  toolCallingStrategy?: "native" | "structured_output";
  /** Which embedding model to use with getEmbedding(). Defaults to "nomic-embed-text-v1.5". */
  embeddingModel?: string;
}

function processFragment(
  fragment: { content: string; reasoningType?: string },
  reasoningText: { value: string },
  responseContent: { value: string },
  onToken?: (token: string, isReasoning: boolean) => void,
) {
  const responseFragment = fragment as LLMPredictionFragmentWithRoundIndex;

  if (responseFragment.reasoningType === "reasoning") {
    reasoningText.value += fragment.content;
    onToken?.(fragment.content, true);
  } else if (responseFragment.reasoningType === "none") {
    // Strip leaked </think> closing tags — the SDK correctly marks reasoning
    // content as "reasoning" but the closing tag itself can arrive as "none".
    const cleaned = fragment.content.replace(/<\/think>/g, "");
    responseContent.value += cleaned;
    if (cleaned) onToken?.(cleaned, false);
  } else {
    // Unknown or undefined reasoningType — treat as regular response content
    // so fragments are never silently discarded.
    const cleaned = fragment.content.replace(/<\/think>/g, "");
    responseContent.value += cleaned;
    if (cleaned) onToken?.(cleaned, false);
  }
}

export class LMStudioProvider implements LLMProvider {
  private client: LMStudioClient;
  private toolCallingStrategy: "native" | "structured_output";
  private embeddingModel: string;

  constructor(
    private model: string = "google/gemma-3-4b",
    endpoint: string = "ws://127.0.0.1:1234",
    options: LMStudioProviderOptions = {},
  ) {
    this.client = new LMStudioClient({
      baseUrl: endpoint,
      verboseErrorMessages: false,
    });
    this.toolCallingStrategy = options.toolCallingStrategy ?? "native";
    this.embeddingModel = options.embeddingModel ?? "nomic-embed-text-v1.5";
  }

  async chat(
    messages: Message[],
    systemPrompt: string = "",
    schema?: LLMStructuredPredictionSetting,
    tools?: ToolDefinition[],
    onToken?: (token: string, isReasoning: boolean) => void,
  ): Promise<ChatResponse> {
    logger.info(
      "LMStudio",
      `chat() model=${this.model} strategy=${this.toolCallingStrategy} tools=${tools?.length ?? 0} messages=${messages.length}`,
    );

    try {
      const chat: ChatLike = Chat.from([]);
      const hasTools = tools && tools.length > 0;
      const definedTools = tools as ToolDefinition[];

      let effectiveSystemPrompt = systemPrompt;
      if (hasTools && this.toolCallingStrategy === "structured_output") {
        effectiveSystemPrompt = [
          systemPrompt,
          buildToolSystemPromptAddition(definedTools),
        ]
          .filter(Boolean)
          .join("\n\n");
      }

      if (effectiveSystemPrompt) {
        chat.append({ role: "system", content: effectiveSystemPrompt });
      }
      for (const message of messages) {
        chat.append(message);
      }

      const modelClient = await this.client.llm.model(this.model, {
        verbose: false,
      });

      if (hasTools && this.toolCallingStrategy === "native") {
        return await this.actWithTools(
          modelClient,
          chat,
          definedTools,
          onToken,
        );
      }

      if (hasTools && this.toolCallingStrategy === "structured_output") {
        const result = await callWithStructuredTools(
          modelClient,
          chat,
          definedTools,
        );
        return {
          response: result,
          nonReasoningContent: result,
          reasoningText: "",
        };
      }

      return await this.respond(modelClient, chat, schema, onToken);
    } catch (error) {
      logger.error("LMStudio", "Error communicating with local server:", error);
      const msg =
        error instanceof Error
          ? `LMStudio error: ${error.message}`
          : "I'm having trouble thinking right now. Is the LMStudio server running?";
      onToken?.(msg, false);
      return { response: msg, nonReasoningContent: msg, reasoningText: "" };
    }
  }

  private async actWithTools(
    modelClient: LLMDynamicHandle,
    chat: ChatLike,
    tools: ToolDefinition[],
    onToken?: (token: string, isReasoning: boolean) => void,
  ): Promise<ChatResponse> {
    const lmstudioTools: Tool[] = tools.map((t) => {
      if (!t.parameters || typeof t.parameters !== "object") {
        throw new Error(
          `Tool "${t.name}" has invalid or missing parameters schema.`,
        );
      }
      const schema = t.parameters as Record<string, unknown>;
      const normalizedSchema =
        schema.properties === undefined
          ? { ...schema, properties: {} }
          : schema;
      return rawFunctionTool({
        name: t.name,
        description: t.description,
        parametersJsonSchema: normalizedSchema,
        implementation: async (params, _ctx) => {
          logger.info("LMStudio", `Tool called by model: ${t.name}`, params);
          if (!t.implementation) {
            throw new Error("Tool implementation not provided.");
          }
          try {
            const result = await t.implementation(params);
            logger.debug(
              "LMStudio",
              `Tool result: ${t.name}`,
              result !== undefined
                ? String(result).slice(0, 200)
                : "(no result)",
            );
            return result;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logger.error("LMStudio", `Tool threw: ${t.name}: ${msg}`);
            return { error: msg };
          }
        },
      });
    });

    let finalContent = "";
    const reasoningText = { value: "" };
    const responseContent = { value: "" };
    let inToolCall = false;
    let hadToolCall = false;
    let postToolResponseStreamed = false;
    let finalRoundNonReasoningContent = "";

    await modelClient.act(chat, lmstudioTools, {
      onMessage: (msg: ChatMessage) => {
        if (msg.getRole() === "assistant" && msg.getText()) {
          finalContent = msg.getText();
        }
      },
      onPredictionCompleted: (result: PredictionResult) => {
        if (result.roundIndex > 0) {
          // Capture the non-reasoning content of each post-tool-call round.
          // The last one will be the final response.
          finalRoundNonReasoningContent = result.nonReasoningContent;
        }
      },
      onToolCallRequestStart: (_roundIndex: number, _callId: number) => {
        inToolCall = true;
        hadToolCall = true;
      },
      onToolCallRequestEnd: (_roundIndex: number, _callId: number) => {
        inToolCall = false;
      },
      onToolCallRequestFailure: (
        _roundIndex: number,
        _callId: number,
        _error: ToolCallRequestError,
      ) => {
        inToolCall = false;
      },
      onPredictionFragment: (fragment: LLMPredictionFragmentWithRoundIndex) => {
        if (inToolCall) return;
        // Track whether any round-2+ response content was streamed
        if (
          hadToolCall &&
          fragment.roundIndex > 0 &&
          fragment.reasoningType === "none"
        ) {
          postToolResponseStreamed = true;
        }
        processFragment(fragment, reasoningText, responseContent, onToken);
      },
    });

    // If tool calls happened but the post-tool response wasn't streamed via
    // onPredictionFragment (e.g. the model produced content that didn't reach
    // our callback), emit the SDK-captured non-reasoning content now so the
    // user sees the response.
    if (
      hadToolCall &&
      !postToolResponseStreamed &&
      finalRoundNonReasoningContent
    ) {
      const cleanedFallback = finalRoundNonReasoningContent.replace(/<\/think>/g, "");
      if (onToken && cleanedFallback) onToken(cleanedFallback, false);
      if (!responseContent.value) {
        responseContent.value = cleanedFallback;
      }
    }

    logger.debug(
      "LMStudio",
      `act() finished, response length=${responseContent.value.length}`,
    );
    return {
      response: finalContent || responseContent.value,
      nonReasoningContent: responseContent.value || finalContent,
      reasoningText: reasoningText.value,
    };
  }

  private async respond(
    modelClient: LLMDynamicHandle,
    chat: ChatLike,
    schema?: LLMStructuredPredictionSetting,
    onToken?: (token: string, isReasoning: boolean) => void,
  ): Promise<ChatResponse> {
    const reasoningText = { value: "" };
    const responseContent = { value: "" };

    for await (const fragment of modelClient.respond(chat, {
      structured: schema,
    })) {
      processFragment(fragment, reasoningText, responseContent, onToken);
    }

    return {
      response: responseContent.value || reasoningText.value,
      nonReasoningContent: responseContent.value,
      reasoningText: reasoningText.value,
    };
  }

  public getModel(): string {
    return this.model;
  }

  public setModel(model: string): void {
    this.model = model;
  }

  public async getEmbedding(text: string): Promise<number[]> {
    const model = await this.client.embedding.model(this.embeddingModel, {
      verbose: false,
    });
    const { embedding } = await model.embed(text);
    return embedding;
  }
}
