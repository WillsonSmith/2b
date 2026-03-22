import type { ChatLike } from "@lmstudio/sdk";
import type { ToolDefinition } from "../../core/Plugin.ts";

const MAX_ITERATIONS = 10;

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
 */
export async function callWithStructuredTools(
  modelClient: any,
  chat: ChatLike,
  tools: ToolDefinition[],
  onToolCall?: (name: string, args: any, result: string) => void,
): Promise<string> {
  const schema = {
    type: "object",
    properties: {
      type: { type: "string", enum: ["tool_call", "message"] },
      tool: { type: "string" },
      args: { type: "object", additionalProperties: true },
      content: { type: "string" },
    },
    required: ["type"],
    additionalProperties: false,
  };

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await modelClient.respond(chat, {
      structured: { type: "json", jsonSchema: schema },
    });

    let parsed: { type: string; tool?: string; args?: any; content?: string };
    try {
      parsed = JSON.parse(response.content);
    } catch {
      // If JSON parse fails, treat the raw content as the final response
      return response.content;
    }

    if (parsed.type === "message") {
      return parsed.content ?? "";
    }

    if (parsed.type === "tool_call" && parsed.tool) {
      const tool = tools.find((t) => t.name === parsed.tool);

      if (!tool || !tool.implementation) {
        (chat as any).append({
          role: "user",
          content: `Tool error: "${parsed.tool}" not found or has no implementation.`,
        });
        continue;
      }

      let result: string;
      try {
        const raw = await tool.implementation(parsed.args ?? {});
        result = typeof raw === "string" ? raw : JSON.stringify(raw);
      } catch {
        result = `Tool error: "${parsed.tool}" failed to execute.`;
      }

      onToolCall?.(parsed.tool, parsed.args, result);

      (chat as any).append({ role: "assistant", content: response.content });
      (chat as any).append({
        role: "user",
        content: `Tool result for ${parsed.tool}: ${result}`,
      });
    }
  }

  return "I reached my tool call limit for this response.";
}
