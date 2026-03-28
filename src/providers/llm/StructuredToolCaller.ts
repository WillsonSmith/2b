import type { ChatLike } from "@lmstudio/sdk";
import type { ToolDefinition } from "../../core/Plugin.ts";

const MAX_ITERATIONS = 10;

/** Minimum interface required of the LMStudio model client used here. */
interface ModelClient {
  respond(
    chat: ChatLike,
    opts: { structured: { type: "json"; jsonSchema: object } },
  ): Promise<{ content: string }>;
}

/** Named error thrown when the tool-call loop reaches its iteration limit. */
export class ToolCallLimitError extends Error {
  constructor() {
    super(`Tool-call loop reached the maximum of ${MAX_ITERATIONS} iterations.`);
    this.name = "ToolCallLimitError";
  }
}

/**
 * JSON Schema for the structured response envelope.
 * Defined at module scope so it is not reallocated on every call.
 */
const RESPONSE_SCHEMA = {
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

/**
 * Appends a message to a chat object.
 * `ChatLike` from @lmstudio/sdk does not expose `append` in its public type,
 * so the cast is encapsulated here rather than repeated at each call site.
 */
function appendToChat(chat: ChatLike, role: "user" | "assistant", content: string): void {
  (chat as unknown as { append(msg: { role: string; content: string }): void }).append({
    role,
    content,
  });
}

/**
 * Builds a system prompt addition that teaches a non-tool-native model
 * how to call tools via structured JSON output.
 */
export function buildToolSystemPromptAddition(tools: ToolDefinition[]): string {
  const toolList = tools
    .map(
      (t) =>
        `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.parameters, null, 2)}`,
    )
    .join("\n");

  return `You have access to tools. To use a tool, respond with ONLY this JSON:
{"type": "tool_call", "tool": "<tool_name>", "args": {<arguments>}}

When you do not need a tool, respond with ONLY this JSON:
{"type": "message", "content": "<your response>"}

Available tools:
${toolList}`.trim();
}

/**
 * Drives a manual tool-call loop for models that don't support native tool calling.
 * Uses constrained JSON decoding (structured output) so any LMStudio-loaded model can work.
 *
 * @throws {ToolCallLimitError} when MAX_ITERATIONS is reached without a final message.
 */
export async function callWithStructuredTools(
  modelClient: ModelClient,
  chat: ChatLike,
  tools: ToolDefinition[],
  onToolCall?: (name: string, args: Record<string, unknown>, result: string) => void,
): Promise<string> {
  // Build a name→tool map once so lookups inside the loop are O(1).
  const toolMap = new Map<string, ToolDefinition>(tools.map((t) => [t.name, t]));

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await modelClient.respond(chat, {
      structured: { type: "json", jsonSchema: RESPONSE_SCHEMA },
    });

    let parsed: { type: string; tool?: string; args?: Record<string, unknown>; content?: string };
    try {
      parsed = JSON.parse(response.content) as typeof parsed;
    } catch {
      // If JSON parse fails, treat the raw content as the final response.
      return response.content;
    }

    if (parsed.type === "message") {
      return parsed.content ?? "";
    }

    if (parsed.type === "tool_call") {
      if (!parsed.tool) {
        // Model produced a tool_call envelope without a tool name — inform and retry.
        appendToChat(chat, "user", 'Tool error: response was missing the "tool" field.');
        continue;
      }

      const tool = toolMap.get(parsed.tool);

      if (!tool || !tool.implementation) {
        appendToChat(
          chat,
          "user",
          `Tool "${parsed.tool}" not found or has no implementation.`,
        );
        continue;
      }

      let result: string;
      try {
        const raw = await tool.implementation(parsed.args ?? {});
        result = typeof raw === "string" ? raw : JSON.stringify(raw);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result = `Tool "${parsed.tool}" threw: ${message}`;
      }

      onToolCall?.(parsed.tool, parsed.args ?? {}, result);

      appendToChat(chat, "assistant", response.content);
      appendToChat(chat, "user", `Tool result for ${parsed.tool}: ${result}`);
    } else {
      // Unknown type — inform the model and allow it to retry.
      appendToChat(
        chat,
        "user",
        `Unexpected response type "${parsed.type}". Respond with "tool_call" or "message".`,
      );
    }
  }

  console.warn(
    `[StructuredToolCaller] Reached maximum of ${MAX_ITERATIONS} iterations. Throwing ToolCallLimitError.`,
  );
  throw new ToolCallLimitError();
}
