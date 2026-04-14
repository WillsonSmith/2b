import { test, expect, describe, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Module mock — must be declared before the import under test
// ---------------------------------------------------------------------------

type MockMessage = {
  role: string;
  content: string;
  thinking?: string;
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
};

// Controls what chat() returns each call
let mockChatResponse: MockMessage = { role: "assistant", content: "hello" };
// Stream chunks emitted when stream: true
let mockStreamChunks: Array<{ message: { content: string; thinking?: string }; done: boolean }> = [];

const mockChat = mock(async (opts: { stream?: boolean }) => {
  if (opts.stream) {
    return (async function* () {
      for (const chunk of mockStreamChunks) yield chunk;
    })();
  }
  return { message: mockChatResponse };
});

const mockEmbed = mock(async (_opts: unknown) => ({
  embeddings: [[0.1, 0.2, 0.3]],
}));

mock.module("ollama", () => ({
  Ollama: class {
    chat = mockChat;
    embed = mockEmbed;
  },
}));

// Import AFTER module mock is set up
const { OllamaProvider } = await import("./OllamaProvider");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(
  strategy: "native" | "structured_output" = "native",
  numCtx?: number,
) {
  return new OllamaProvider("test-model", "http://127.0.0.1:11434", {
    toolCallingStrategy: strategy,
    numCtx,
  });
}

/**
 * Wraps message objects in an async generator so actWithTools can iterate
 * over them with `for await`. actWithTools uses stream: true, so mock
 * responses must be async iterables, not plain objects.
 */
function streamOf(...messages: Array<{ role?: string; content: string; thinking?: string; tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }> }>) {
  return (async function* () {
    for (const msg of messages) yield { message: msg };
  })();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("system prompt handling", () => {
  beforeEach(() => {
    mockStreamChunks = [{ message: { content: "reply" }, done: true }];
    mockChat.mockClear?.();
  });

  test("system prompt is prepended as system role message", async () => {
    const provider = makeProvider();
    await provider.chat([], "You are helpful.");

    const calls = mockChat.mock.calls;
    const messages = (calls[0]?.[0] as any).messages as MockMessage[];
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toBe("You are helpful.");
  });

  test("no system message when systemPrompt is empty", async () => {
    const provider = makeProvider();
    await provider.chat([{ role: "user", content: "hi" }], "");

    const messages = (mockChat.mock.calls[0]?.[0] as any).messages as MockMessage[];
    expect(messages.every((m) => m.role !== "system")).toBe(true);
  });

  test("structured_output strategy injects tool schema into system prompt", async () => {
    const provider = makeProvider("structured_output");
    const tools = [
      {
        name: "ping",
        description: "Ping tool",
        parameters: { type: "object", properties: {} },
        implementation: async () => "pong",
      },
    ];

    // Make the structured loop return a terminal message on first call
    mockChat.mockImplementationOnce(async () => ({
      message: { role: "assistant", content: '{"type":"message","content":"done"}' },
    }));

    await provider.chat([], "base prompt", undefined, tools as any);

    const messages = (mockChat.mock.calls[0]?.[0] as any).messages as MockMessage[];
    const systemMsg = messages.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("base prompt");
    expect(systemMsg?.content).toContain("ping");
  });

  test("native strategy does NOT inject tool schema into system prompt", async () => {
    const provider = makeProvider("native");
    const tools = [
      {
        name: "ping",
        description: "Ping tool",
        parameters: { type: "object", properties: {} },
        implementation: async () => "pong",
      },
    ];

    // Return a non-tool response so actWithTools exits cleanly
    mockChat.mockImplementationOnce(async () => ({
      message: { role: "assistant", content: "done", tool_calls: [] },
    }));

    await provider.chat([], "base prompt", undefined, tools as any);

    const messages = (mockChat.mock.calls[0]?.[0] as any).messages as MockMessage[];
    const systemMsg = messages.find((m) => m.role === "system");
    expect(systemMsg?.content).not.toContain('"tool_call"');
  });
});

describe("streaming and reasoning via message.thinking field", () => {
  beforeEach(() => {
    mockChat.mockClear?.();
  });

  test("plain content is returned as nonReasoningContent", async () => {
    mockStreamChunks = [
      { message: { content: "Hello " }, done: false },
      { message: { content: "world" }, done: true },
    ];
    const provider = makeProvider();
    const result = await provider.chat([{ role: "user", content: "hi" }], "");
    expect(result.nonReasoningContent).toBe("Hello world");
    expect(result.reasoningText).toBe("");
  });

  test("message.thinking chunks are collected into reasoningText", async () => {
    mockStreamChunks = [
      { message: { content: "", thinking: "I am " }, done: false },
      { message: { content: "", thinking: "thinking" }, done: false },
      { message: { content: "Final answer" }, done: true },
    ];
    const provider = makeProvider();
    const result = await provider.chat([{ role: "user", content: "hi" }], "");
    expect(result.reasoningText).toBe("I am thinking");
    expect(result.nonReasoningContent).toBe("Final answer");
  });

  test("onToken callback receives reasoning and response tokens with correct flags", async () => {
    mockStreamChunks = [
      { message: { content: "", thinking: "thought" }, done: false },
      { message: { content: "reply" }, done: true },
    ];
    const provider = makeProvider();
    const tokens: Array<{ token: string; isReasoning: boolean }> = [];
    await provider.chat([], "", undefined, undefined, (t, r) => tokens.push({ token: t, isReasoning: r }));

    const reasoningTokens = tokens.filter((t) => t.isReasoning);
    const responseTokens = tokens.filter((t) => !t.isReasoning);
    expect(reasoningTokens.map((t) => t.token).join("")).toBe("thought");
    expect(responseTokens.map((t) => t.token).join("")).toBe("reply");
  });

  test("streaming callback is invoked for each content chunk", async () => {
    mockStreamChunks = [
      { message: { content: "a" }, done: false },
      { message: { content: "b" }, done: false },
      { message: { content: "c" }, done: true },
    ];
    const provider = makeProvider();
    const received: string[] = [];
    await provider.chat([], "", undefined, undefined, (t) => received.push(t));
    expect(received).toEqual(["a", "b", "c"]);
  });

  test("think: true is sent in the request by default", async () => {
    mockStreamChunks = [{ message: { content: "ok" }, done: true }];
    const provider = makeProvider();
    await provider.chat([], "");
    const req = mockChat.mock.calls[0]?.[0] as any;
    expect(req.think).toBe(true);
  });

  test("think option is forwarded when set to false", async () => {
    mockStreamChunks = [{ message: { content: "ok" }, done: true }];
    const provider = new OllamaProvider("test-model", "http://127.0.0.1:11434", { think: false });
    await provider.chat([], "");
    const req = mockChat.mock.calls[0]?.[0] as any;
    expect(req.think).toBe(false);
  });

  test("think option accepts budget level strings", async () => {
    mockStreamChunks = [{ message: { content: "ok" }, done: true }];
    const provider = new OllamaProvider("test-model", "http://127.0.0.1:11434", { think: "high" });
    await provider.chat([], "");
    const req = mockChat.mock.calls[0]?.[0] as any;
    expect(req.think).toBe("high");
  });
});

describe("native tool calling", () => {
  beforeEach(() => {
    mockChat.mockClear?.();
  });

  test("tools are sent in OpenAI function format", async () => {
    const provider = makeProvider("native");
    const tools = [
      {
        name: "search",
        description: "Search the web",
        parameters: { type: "object", properties: { query: { type: "string" } } },
        implementation: async () => "result",
      },
    ];

    mockChat.mockImplementationOnce(async () => ({
      message: { role: "assistant", content: "done", tool_calls: [] },
    }));

    await provider.chat([], "", undefined, tools as any);

    const sentTools = (mockChat.mock.calls[0]?.[0] as any).tools as any[];
    expect(sentTools).toBeDefined();
    expect(sentTools[0]?.type).toBe("function");
    expect(sentTools[0]?.function?.name).toBe("search");
    expect(sentTools[0]?.function?.description).toBe("Search the web");
  });

  test("tool is called and result appended before final response", async () => {
    const provider = makeProvider("native");
    const impl = mock(async () => "tool-output");
    const tools = [
      {
        name: "greet",
        description: "Says hello",
        parameters: { type: "object", properties: {} },
        implementation: impl,
      },
    ];

    // Round 1: model calls the tool
    mockChat
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "greet", arguments: {} } }],
      }))
      // Round 2: model produces final text
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "Hello!",
      }));

    const result = await provider.chat([], "", undefined, tools as any);

    expect(impl).toHaveBeenCalledTimes(1);
    expect(result.nonReasoningContent).toBe("Hello!");
    // Second call should include a tool result message
    const round2Messages = (mockChat.mock.calls[1]?.[0] as any).messages as (MockMessage & { tool_name?: string })[];
    const toolMsg = round2Messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("tool-output");
    expect(toolMsg?.tool_name).toBe("greet");
  });

  test("tool implementation error is returned as error JSON, not thrown", async () => {
    const provider = makeProvider("native");
    const tools = [
      {
        name: "bad",
        description: "Throws",
        parameters: { type: "object", properties: {} },
        implementation: async () => { throw new Error("boom"); },
      },
    ];

    mockChat
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "bad", arguments: {} } }],
      }))
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "recovered",
      }));

    const result = await provider.chat([], "", undefined, tools as any);
    expect(result.nonReasoningContent).toBe("recovered");
    const round2Messages = (mockChat.mock.calls[1]?.[0] as any).messages as (MockMessage & { tool_name?: string })[];
    const toolMsg = round2Messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("boom");
    expect(toolMsg?.tool_name).toBe("bad");
  });

  test("reasoning from final round is returned in reasoningText", async () => {
    const provider = makeProvider("native");
    const tools = [
      {
        name: "noop",
        description: "Does nothing",
        parameters: { type: "object", properties: {} },
        implementation: async () => "ok",
      },
    ];

    mockChat
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "noop", arguments: {} } }],
      }))
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "answer",
        thinking: "my reasoning",
      }));

    const result = await provider.chat([], "", undefined, tools as any);
    expect(result.reasoningText).toBe("my reasoning");
    expect(result.nonReasoningContent).toBe("answer");
  });

  test("all tool implementations are invoked when multiple calls arrive in a single round", async () => {
    const provider = makeProvider("native");
    const impl1 = mock(async () => "result1");
    const impl2 = mock(async () => "result2");
    const tools = [
      { name: "tool1", description: "Tool 1", parameters: { type: "object", properties: {} }, implementation: impl1 },
      { name: "tool2", description: "Tool 2", parameters: { type: "object", properties: {} }, implementation: impl2 },
    ];

    mockChat
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "tool1", arguments: {} } },
          { function: { name: "tool2", arguments: {} } },
        ],
      }))
      .mockImplementationOnce(async () => streamOf({ role: "assistant", content: "done" }));

    const result = await provider.chat([], "", undefined, tools as any);

    expect(impl1).toHaveBeenCalledTimes(1);
    expect(impl2).toHaveBeenCalledTimes(1);
    expect(result.nonReasoningContent).toBe("done");
  });

  test("multiple tool implementations run concurrently, not sequentially", async () => {
    const provider = makeProvider("native");
    const order: string[] = [];

    const tools = [
      {
        name: "slow",
        description: "slow tool",
        parameters: { type: "object", properties: {} },
        implementation: mock(async () => {
          order.push("slow-start");
          await new Promise((r) => setTimeout(r, 40));
          order.push("slow-end");
          return "slow-result";
        }),
      },
      {
        name: "fast",
        description: "fast tool",
        parameters: { type: "object", properties: {} },
        implementation: mock(async () => {
          order.push("fast-start");
          await new Promise((r) => setTimeout(r, 5));
          order.push("fast-end");
          return "fast-result";
        }),
      },
    ];

    mockChat
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "slow", arguments: {} } },
          { function: { name: "fast", arguments: {} } },
        ],
      }))
      .mockImplementationOnce(async () => streamOf({ role: "assistant", content: "done" }));

    await provider.chat([], "", undefined, tools as any);

    // Both start before either ends — proving concurrent execution
    expect(order).toEqual(["slow-start", "fast-start", "fast-end", "slow-end"]);
  });

  test("tool results are appended to history in original call order regardless of completion order", async () => {
    const provider = makeProvider("native");

    const tools = [
      {
        name: "slow",
        description: "slow tool",
        parameters: { type: "object", properties: {} },
        implementation: mock(async () => {
          await new Promise((r) => setTimeout(r, 30));
          return "slow-result";
        }),
      },
      {
        name: "fast",
        description: "fast tool",
        parameters: { type: "object", properties: {} },
        implementation: mock(async () => "fast-result"),
      },
    ];

    mockChat
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "",
        tool_calls: [
          { function: { name: "slow", arguments: {} } },
          { function: { name: "fast", arguments: {} } },
        ],
      }))
      .mockImplementationOnce(async () => streamOf({ role: "assistant", content: "done" }));

    await provider.chat([], "", undefined, tools as any);

    const round2Messages = (mockChat.mock.calls[1]?.[0] as any).messages as (MockMessage & { tool_name?: string })[];
    const toolMsgs = round2Messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs[0]?.tool_name).toBe("slow");
    expect(toolMsgs[0]?.content).toBe("slow-result");
    expect(toolMsgs[1]?.tool_name).toBe("fast");
    expect(toolMsgs[1]?.content).toBe("fast-result");
  });

  test("onToken called with final response content after tool rounds", async () => {
    const provider = makeProvider("native");
    const tools = [
      {
        name: "noop",
        description: "Does nothing",
        parameters: { type: "object", properties: {} },
        implementation: async () => "ok",
      },
    ];

    mockChat
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "noop", arguments: {} } }],
      }))
      .mockImplementationOnce(async () => streamOf({
        role: "assistant",
        content: "final text",
      }));

    const tokens: string[] = [];
    await provider.chat([], "", undefined, tools as any, (t) => tokens.push(t));
    expect(tokens).toContain("final text");
  });
});

describe("num_ctx option", () => {
  beforeEach(() => {
    mockStreamChunks = [{ message: { content: "ok" }, done: true }];
    mockChat.mockClear?.();
  });

  test("num_ctx is passed in options when set", async () => {
    const provider = makeProvider("native", 8192);
    await provider.chat([{ role: "user", content: "hi" }], "");
    const opts = (mockChat.mock.calls[0]?.[0] as any).options;
    expect(opts?.num_ctx).toBe(8192);
  });

  test("options field is omitted when numCtx is not set", async () => {
    const provider = makeProvider("native", undefined);
    await provider.chat([{ role: "user", content: "hi" }], "");
    const opts = (mockChat.mock.calls[0]?.[0] as any).options;
    expect(opts).toBeUndefined();
  });
});

describe("error handling", () => {
  test("connection error returns graceful message, does not throw", async () => {
    mockChat.mockImplementationOnce(async () => {
      throw new Error("ECONNREFUSED: connection refused");
    });
    const provider = makeProvider();
    const result = await provider.chat([{ role: "user", content: "hi" }], "");
    expect(result.response).toContain("Ollama error:");
    expect(result.response).not.toBe("");
  });

  test("error message is emitted via onToken", async () => {
    mockChat.mockImplementationOnce(async () => {
      throw new Error("timeout");
    });
    const provider = makeProvider();
    const tokens: string[] = [];
    await provider.chat([], "", undefined, undefined, (t) => tokens.push(t));
    expect(tokens.join("")).toContain("Ollama error:");
  });
});

describe("getEmbedding", () => {
  beforeEach(() => {
    mockEmbed.mockClear?.();
  });

  test("returns embedding vector from embed response", async () => {
    const provider = makeProvider();
    const embedding = await provider.getEmbedding("test text");
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding).toEqual([0.1, 0.2, 0.3]);
  });

  test("text longer than 7200 chars is truncated before embedding", async () => {
    const provider = makeProvider();
    const longText = "a".repeat(8000);
    await provider.getEmbedding(longText);
    const passedInput = (mockEmbed.mock.calls[0]?.[0] as any).input as string;
    expect(passedInput.length).toBe(7200);
  });

  test("text at exactly 7200 chars is not truncated", async () => {
    const provider = makeProvider();
    const text = "b".repeat(7200);
    await provider.getEmbedding(text);
    const passedInput = (mockEmbed.mock.calls[0]?.[0] as any).input as string;
    expect(passedInput.length).toBe(7200);
  });

  test("uses embeddingModel, not chat model", async () => {
    const provider = new OllamaProvider("chat-model", "http://127.0.0.1:11434", {
      embeddingModel: "custom-embed-model",
    });
    await provider.getEmbedding("hello");
    const model = (mockEmbed.mock.calls[0]?.[0] as any).model as string;
    expect(model).toBe("custom-embed-model");
  });
});
