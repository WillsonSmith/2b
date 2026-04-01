import { test, expect, describe, mock, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Module mock — must be declared before the import under test
// ---------------------------------------------------------------------------

// Track what the mock model appends to the chat
const chatMessages: { role: string; content: string }[] = [];
const mockChatAppend = mock((msg: { role: string; content: string }) => {
  chatMessages.push(msg);
});
const mockChat = { append: mockChatAppend };

// Fragments to yield from respond()
let respondFragments: Array<{ content: string; reasoningType?: string }> = [];
// Responses from act()
let actCallback: ((msg: any) => void) | null = null;

const mockModelClient = {
  respond: mock(async function* (_chat: any, _opts: any) {
    for (const f of respondFragments) yield f;
  }),
  act: mock(async (_chat: any, _tools: any, callbacks: any) => {
    // Do nothing by default; tests can override act behaviour
  }),
};

const mockLlmModel = mock(async () => mockModelClient);

const mockEmbedModel = { embed: mock(async (_text: string) => ({ embedding: [0.1, 0.2, 0.3] })) };
const mockEmbeddingModel = mock(async () => mockEmbedModel);

mock.module("@lmstudio/sdk", () => ({
  LMStudioClient: class {
    llm = { model: mockLlmModel };
    embedding = { model: mockEmbeddingModel };
  },
  Chat: { from: () => mockChat },
  rawFunctionTool: (config: any) => config,
  // Anything else the SDK exports that the provider might use
}));

// Import AFTER module mock is set up
const { LMStudioProvider } = await import("./LMStudioProvider");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProvider(strategy: "native" | "structured_output" = "native") {
  return new LMStudioProvider("test-model", "ws://127.0.0.1:1234", {
    toolCallingStrategy: strategy,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("system prompt augmentation", () => {
  beforeEach(() => {
    chatMessages.length = 0;
    respondFragments = [{ content: "reply", reasoningType: "none" }];
    mockModelClient.respond.mockClear?.();
    mockModelClient.act.mockClear?.();
  });

  test("structured_output strategy appends tool definitions to system prompt", async () => {
    const provider = makeProvider("structured_output");
    const tools = [
      { name: "ping", description: "Ping tool", parameters: { type: "object", properties: {} } },
    ];
    // callWithStructuredTools will call modelClient.respond internally
    // Make it return a terminal message so the loop exits
    (mockModelClient as any).respond = mock(async function* () {
      yield { content: '{"type":"message","content":"done"}' };
    });

    await provider.chat([], "base system prompt", undefined, tools as any);

    const systemMsg = chatMessages.find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("base system prompt");
    expect(systemMsg?.content).toContain("ping");
  });

  test("native strategy does NOT add tool definitions to system prompt", async () => {
    chatMessages.length = 0;
    const provider = makeProvider("native");
    const tools = [
      { name: "ping", description: "Ping tool", parameters: { type: "object", properties: {} } },
    ];
    // act() won't stream, just completes
    (mockModelClient as any).act = mock(async () => {});

    await provider.chat([], "system prompt", undefined, tools as any);

    const systemMsg = chatMessages.find((m) => m.role === "system");
    // Should not contain raw tool schema injected into system prompt
    expect(systemMsg?.content).not.toContain('"tool_call"');
  });
});

describe("fragment processing", () => {
  beforeEach(() => {
    chatMessages.length = 0;
    (mockModelClient as any).respond = mock(async function* (_chat: any, _opts: any) {
      for (const f of respondFragments) yield f;
    });
  });

  test("reasoning fragments are collected in reasoningText", async () => {
    respondFragments = [
      { content: "I think...", reasoningType: "reasoning" },
      { content: "final answer", reasoningType: "none" },
    ];
    const provider = makeProvider();
    const result = await provider.chat([{ role: "user", content: "hello" }], "");
    expect(result.reasoningText).toBe("I think...");
    expect(result.nonReasoningContent).toBe("final answer");
  });

  test("non-reasoning fragments are returned as response content", async () => {
    respondFragments = [
      { content: "Hello ", reasoningType: "none" },
      { content: "world", reasoningType: "none" },
    ];
    const provider = makeProvider();
    const result = await provider.chat([{ role: "user", content: "hi" }], "");
    expect(result.nonReasoningContent).toBe("Hello world");
  });

  test("streaming token callback receives each fragment with correct isReasoning flag", async () => {
    respondFragments = [
      { content: "thought", reasoningType: "reasoning" },
      { content: "response", reasoningType: "none" },
    ];
    const provider = makeProvider();
    const tokens: Array<{ token: string; isReasoning: boolean }> = [];
    await provider.chat([{ role: "user", content: "hi" }], "", undefined, undefined, (t, r) =>
      tokens.push({ token: t, isReasoning: r }),
    );
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({ token: "thought", isReasoning: true });
    expect(tokens[1]).toEqual({ token: "response", isReasoning: false });
  });

  test("trailing </think> artifacts are stripped from response content", async () => {
    respondFragments = [
      { content: "content</think>more", reasoningType: "none" },
    ];
    const provider = makeProvider();
    const result = await provider.chat([{ role: "user", content: "hi" }], "");
    expect(result.nonReasoningContent).toBe("contentmore");
    expect(result.nonReasoningContent).not.toContain("</think>");
  });

  test("unknown reasoningType is treated as regular content (not discarded)", async () => {
    respondFragments = [{ content: "mystery content" }]; // no reasoningType
    const provider = makeProvider();
    const result = await provider.chat([{ role: "user", content: "hi" }], "");
    expect(result.nonReasoningContent).toContain("mystery content");
  });
});

describe("chat message marshaling", () => {
  beforeEach(() => {
    chatMessages.length = 0;
    respondFragments = [{ content: "reply", reasoningType: "none" }];
    (mockModelClient as any).respond = mock(async function* () {
      for (const f of respondFragments) yield f;
    });
  });

  test("user and assistant messages are appended in order", async () => {
    const messages = [
      { role: "user" as const, content: "hello" },
      { role: "assistant" as const, content: "hi there" },
      { role: "user" as const, content: "thanks" },
    ];
    const provider = makeProvider();
    await provider.chat(messages, "sys");
    const userMsgs = chatMessages.filter((m) => m.role === "user").map((m) => m.content);
    expect(userMsgs).toContain("hello");
    expect(userMsgs).toContain("thanks");
    const assistantMsgs = chatMessages.filter((m) => m.role === "assistant").map((m) => m.content);
    expect(assistantMsgs).toContain("hi there");
  });

  test("system prompt is prepended as system role message", async () => {
    const provider = makeProvider();
    await provider.chat([], "You are a helpful assistant.");
    const systemMsg = chatMessages.find((m) => m.role === "system");
    expect(systemMsg?.content).toBe("You are a helpful assistant.");
  });
});

describe("error handling", () => {
  test("connection error produces meaningful message, not unhandled rejection", async () => {
    (mockModelClient as any).respond = mock(async function* () {
      throw new Error("ECONNREFUSED: connection refused");
    });
    mockLlmModel.mockImplementationOnce(async () => {
      throw new Error("ECONNREFUSED: connection refused");
    });

    const provider = makeProvider();
    const result = await provider.chat([{ role: "user", content: "hi" }], "");
    expect(result.response).toContain("LMStudio error:");
    expect(result.response).not.toBe("");
  });
});

describe("getEmbedding", () => {
  test("returns embedding vector from embedding model", async () => {
    const provider = makeProvider();
    const embedding = await provider.getEmbedding("test text");
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding.length).toBeGreaterThan(0);
    expect(mockEmbeddingModel.mock.calls.length).toBeGreaterThan(0);
  });

  test("uses embedding model (not LLM model) for embed calls", async () => {
    mockLlmModel.mockClear?.();
    mockEmbeddingModel.mockClear?.();
    const provider = makeProvider();
    await provider.getEmbedding("some text");
    expect(mockEmbeddingModel.mock.calls.length).toBeGreaterThan(0);
  });

  test("short text is passed to embed unchanged", async () => {
    mockEmbedModel.embed.mockClear?.();
    const provider = makeProvider();
    await provider.getEmbedding("hello");
    expect(mockEmbedModel.embed.mock.calls[0]?.[0]).toBe("hello");
  });

  test("text longer than 7200 chars is truncated to 7200 before embedding", async () => {
    mockEmbedModel.embed.mockClear?.();
    const provider = makeProvider();
    const longText = "a".repeat(8000);
    await provider.getEmbedding(longText);
    const passedText = mockEmbedModel.embed.mock.calls[0]?.[0] as string;
    expect(passedText.length).toBe(7200);
    expect(passedText).toBe(longText.slice(0, 7200));
  });

  test("text at exactly 7200 chars is not truncated", async () => {
    mockEmbedModel.embed.mockClear?.();
    const provider = makeProvider();
    const boundaryText = "b".repeat(7200);
    await provider.getEmbedding(boundaryText);
    const passedText = mockEmbedModel.embed.mock.calls[0]?.[0] as string;
    expect(passedText.length).toBe(7200);
  });

  test("text at 7199 chars is not truncated", async () => {
    mockEmbedModel.embed.mockClear?.();
    const provider = makeProvider();
    const text = "c".repeat(7199);
    await provider.getEmbedding(text);
    const passedText = mockEmbedModel.embed.mock.calls[0]?.[0] as string;
    expect(passedText.length).toBe(7199);
  });
});
