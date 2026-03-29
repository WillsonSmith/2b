import { test, expect, describe, mock } from "bun:test";
import {
  buildToolSystemPromptAddition,
  callWithStructuredTools,
  ToolCallLimitError,
} from "./StructuredToolCaller";
import type { ToolDefinition } from "../../core/Plugin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChat() {
  const messages: { role: string; content: string }[] = [];
  return {
    append: mock((msg: { role: string; content: string }) => messages.push(msg)),
    messages,
  };
}

function makeClient(responses: string[]) {
  let idx = 0;
  return {
    respond: mock(async () => ({ content: responses[idx++] ?? '{"type":"message","content":"done"}' })),
  };
}

function makeTool(name: string, impl: (args: any) => any): ToolDefinition {
  return {
    name,
    description: `Does ${name}`,
    parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
    implementation: impl,
  };
}

// ---------------------------------------------------------------------------
// buildToolSystemPromptAddition
// ---------------------------------------------------------------------------

describe("buildToolSystemPromptAddition", () => {
  test("includes all tool names in the output", () => {
    const tools = [
      makeTool("search", async () => "results"),
      makeTool("calculate", async () => "42"),
    ];
    const prompt = buildToolSystemPromptAddition(tools);
    expect(prompt).toContain("search");
    expect(prompt).toContain("calculate");
  });

  test("includes tool descriptions", () => {
    const tools = [makeTool("myTool", async () => "x")];
    const prompt = buildToolSystemPromptAddition(tools);
    expect(prompt).toContain("Does myTool");
  });

  test("includes parameter schema as JSON", () => {
    const tools = [makeTool("test", async () => "x")];
    const prompt = buildToolSystemPromptAddition(tools);
    expect(prompt).toContain('"type"');
    expect(prompt).toContain('"object"');
  });

  test("includes tool_call / message format instructions", () => {
    const prompt = buildToolSystemPromptAddition([]);
    expect(prompt).toContain("tool_call");
    expect(prompt).toContain("message");
  });
});

// ---------------------------------------------------------------------------
// JSON parse failure
// ---------------------------------------------------------------------------

describe("JSON parse failure", () => {
  test("returns raw content when model returns invalid JSON", async () => {
    const chat = makeChat();
    const client = makeClient(["not valid json"]);
    const result = await callWithStructuredTools(client as any, chat as any, []);
    expect(result).toBe("not valid json");
  });
});

// ---------------------------------------------------------------------------
// response type: "message"
// ---------------------------------------------------------------------------

describe('response type "message"', () => {
  test("terminates loop and returns content", async () => {
    const chat = makeChat();
    const client = makeClient(['{"type":"message","content":"hello world"}']);
    const result = await callWithStructuredTools(client as any, chat as any, []);
    expect(result).toBe("hello world");
    expect(client.respond.mock.calls).toHaveLength(1);
  });

  test("returns empty string when content field is missing", async () => {
    const chat = makeChat();
    const client = makeClient(['{"type":"message"}']);
    const result = await callWithStructuredTools(client as any, chat as any, []);
    expect(result).toBe("");
  });
});

// ---------------------------------------------------------------------------
// response type: "tool_call"
// ---------------------------------------------------------------------------

describe('response type "tool_call"', () => {
  test("dispatches to the correct tool implementation", async () => {
    const chat = makeChat();
    const impl = mock(async () => "tool result");
    const tools = [makeTool("my_tool", impl)];
    const responses = [
      '{"type":"tool_call","tool":"my_tool","args":{"input":"hello"}}',
      '{"type":"message","content":"done"}',
    ];
    const client = makeClient(responses);
    await callWithStructuredTools(client as any, chat as any, tools);
    expect(impl.mock.calls).toHaveLength(1);
    expect((impl.mock.calls[0] as any[])[0]).toEqual({ input: "hello" });
  });

  test("stringifies non-string tool result", async () => {
    const chat = makeChat();
    const tools = [makeTool("json_tool", async () => ({ key: "value" }))];
    const responses = [
      '{"type":"tool_call","tool":"json_tool","args":{}}',
      '{"type":"message","content":"done"}',
    ];
    const client = makeClient(responses);
    await callWithStructuredTools(client as any, chat as any, tools);
    const toolResultMsg = chat.messages.find((m) => m.content.includes("Tool result for json_tool"));
    expect(toolResultMsg?.content).toContain('"key"');
    expect(toolResultMsg?.content).toContain('"value"');
  });

  test("invokes onToolCall callback after each execution", async () => {
    const chat = makeChat();
    const tools = [makeTool("ping", async () => "pong")];
    const responses = [
      '{"type":"tool_call","tool":"ping","args":{}}',
      '{"type":"tool_call","tool":"ping","args":{}}',
      '{"type":"message","content":"done"}',
    ];
    const client = makeClient(responses);
    const onToolCall = mock((_name: string, _args: any, _result: string) => {});
    await callWithStructuredTools(client as any, chat as any, tools, onToolCall);
    expect(onToolCall.mock.calls).toHaveLength(2);
    const firstCall = onToolCall.mock.calls[0] as any[];
    expect(firstCall[0]).toBe("ping");
    expect(firstCall[2]).toBe("pong");
  });
});

// ---------------------------------------------------------------------------
// Unknown response type
// ---------------------------------------------------------------------------

describe("unknown response type", () => {
  test("sends informative chat message and does not crash", async () => {
    const chat = makeChat();
    // First response: unknown type; second: valid message to terminate
    const responses = [
      '{"type":"banana"}',
      '{"type":"message","content":"recovered"}',
    ];
    const client = makeClient(responses);
    const result = await callWithStructuredTools(client as any, chat as any, []);
    expect(result).toBe("recovered");
    const errorMsg = chat.messages.find((m) => m.content.includes("Unexpected response type"));
    expect(errorMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Missing or unknown tool name
// ---------------------------------------------------------------------------

describe("missing or unknown tool name", () => {
  test("missing tool field appends error and retries", async () => {
    const chat = makeChat();
    const responses = [
      '{"type":"tool_call"}',
      '{"type":"message","content":"done"}',
    ];
    const client = makeClient(responses);
    await callWithStructuredTools(client as any, chat as any, []);
    const errMsg = chat.messages.find((m) => m.content.includes('missing the "tool" field'));
    expect(errMsg).toBeDefined();
  });

  test("unknown tool name appends descriptive error and retries", async () => {
    const chat = makeChat();
    const responses = [
      '{"type":"tool_call","tool":"ghost","args":{}}',
      '{"type":"message","content":"done"}',
    ];
    const client = makeClient(responses);
    await callWithStructuredTools(client as any, chat as any, []);
    const errMsg = chat.messages.find((m) => m.content.includes('"ghost" not found'));
    expect(errMsg).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// ToolCallLimitError
// ---------------------------------------------------------------------------

describe("ToolCallLimitError", () => {
  test("thrown after exactly 10 iterations", async () => {
    const chat = makeChat();
    // Always return an unknown type — loop will never terminate naturally
    const client = makeClient(Array(15).fill('{"type":"banana"}'));
    await expect(callWithStructuredTools(client as any, chat as any, [])).rejects.toBeInstanceOf(
      ToolCallLimitError,
    );
    expect(client.respond.mock.calls).toHaveLength(10);
  });

  test("ToolCallLimitError has descriptive message", () => {
    const err = new ToolCallLimitError();
    expect(err.message).toContain("10");
    expect(err.name).toBe("ToolCallLimitError");
  });
});
