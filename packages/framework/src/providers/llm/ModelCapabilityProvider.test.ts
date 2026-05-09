import { test, expect, describe, mock, beforeEach } from "bun:test";
import { ModelCapabilityProvider } from "./ModelCapabilityProvider.ts";
import type { ChatResponse } from "./LLMProvider.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInnerProvider() {
  const chat = mock(
    async (
      _messages: unknown,
      systemPrompt?: string,
    ): Promise<ChatResponse> => ({
      response: systemPrompt ?? "",
      nonReasoningContent: systemPrompt ?? "",
      reasoningText: "",
    }),
  );
  const getEmbedding = mock(async (_text: string) => [0.1, 0.2, 0.3]);
  const setModel = mock((_model: string) => {});
  const getModel = mock(() => "inner-model");

  return { chat, getEmbedding, setModel, getModel };
}

// ---------------------------------------------------------------------------
// System prompt prefix injection
// ---------------------------------------------------------------------------

describe("system prompt prefix injection", () => {
  let inner: ReturnType<typeof makeInnerProvider>;

  beforeEach(() => {
    inner = makeInnerProvider();
  });

  test("prepends <|think|> for gemma4 models", async () => {
    const provider = new ModelCapabilityProvider(inner, "gemma4:26b");
    await provider.chat([], "You are helpful.");

    const forwarded = inner.chat.mock.calls[0]?.[1];
    expect(forwarded).toBe("<|think|>You are helpful.");
  });

  test("prepends prefix to an empty system prompt", async () => {
    const provider = new ModelCapabilityProvider(inner, "gemma4:12b");
    await provider.chat([], "");

    const forwarded = inner.chat.mock.calls[0]?.[1];
    expect(forwarded).toBe("<|think|>");
  });

  test("prepends prefix when systemPrompt is undefined", async () => {
    const provider = new ModelCapabilityProvider(inner, "gemma4:12b");
    await provider.chat([]);

    const forwarded = inner.chat.mock.calls[0]?.[1];
    expect(forwarded).toBe("<|think|>");
  });

  test("does not modify the system prompt for non-capability models", async () => {
    const provider = new ModelCapabilityProvider(inner, "llama3.2");
    await provider.chat([], "You are helpful.");

    const forwarded = inner.chat.mock.calls[0]?.[1];
    expect(forwarded).toBe("You are helpful.");
  });

  test("does not modify an undefined system prompt for non-capability models", async () => {
    const provider = new ModelCapabilityProvider(inner, "qwen/qwen3.5-35b-a3b");
    await provider.chat([]);

    const forwarded = inner.chat.mock.calls[0]?.[1];
    expect(forwarded).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// setModel / getModel
// ---------------------------------------------------------------------------

describe("setModel", () => {
  let inner: ReturnType<typeof makeInnerProvider>;

  beforeEach(() => {
    inner = makeInnerProvider();
  });

  test("updates capability lookup for subsequent chat calls", async () => {
    const provider = new ModelCapabilityProvider(inner, "llama3.2");

    // Before: no prefix
    await provider.chat([], "base");
    expect(inner.chat.mock.calls[0]?.[1]).toBe("base");

    inner.chat.mockClear?.();

    // Switch to a model that needs a prefix
    provider.setModel("gemma4:26b");
    await provider.chat([], "base");
    expect(inner.chat.mock.calls[0]?.[1]).toBe("<|think|>base");
  });

  test("forwards setModel to the inner provider", () => {
    const provider = new ModelCapabilityProvider(inner, "llama3.2");
    provider.setModel("gemma4:26b");
    expect(inner.setModel).toHaveBeenCalledWith("gemma4:26b");
  });

  test("getModel returns the current model", () => {
    const provider = new ModelCapabilityProvider(inner, "llama3.2");
    expect(provider.getModel()).toBe("llama3.2");
    provider.setModel("gemma4:26b");
    expect(provider.getModel()).toBe("gemma4:26b");
  });
});

// ---------------------------------------------------------------------------
// Delegation
// ---------------------------------------------------------------------------

describe("delegation", () => {
  let inner: ReturnType<typeof makeInnerProvider>;

  beforeEach(() => {
    inner = makeInnerProvider();
  });

  test("getEmbedding delegates to the inner provider", async () => {
    const provider = new ModelCapabilityProvider(inner, "llama3.2");
    const result = await provider.getEmbedding("hello");
    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(inner.getEmbedding).toHaveBeenCalledWith("hello");
  });

  test("chat return value is passed through unchanged", async () => {
    inner.chat.mockImplementationOnce(async () => ({
      response: "full response",
      nonReasoningContent: "clean",
      reasoningText: "thought",
    }));

    const provider = new ModelCapabilityProvider(inner, "llama3.2");
    const result = await provider.chat([], "prompt");

    expect(result.response).toBe("full response");
    expect(result.nonReasoningContent).toBe("clean");
    expect(result.reasoningText).toBe("thought");
  });

  test("tools and schema are forwarded to the inner provider", async () => {
    const provider = new ModelCapabilityProvider(inner, "llama3.2");
    const tools = [
      {
        name: "ping",
        description: "Ping",
        parameters: { type: "object", properties: {} },
        implementation: async () => "pong",
      },
    ];
    const schema = { type: "object" };

    await provider.chat([], "prompt", schema, tools as any);

    const call = inner.chat.mock.calls[0] as any[];
    expect(call[2]).toBe(schema);
    expect(call[3]).toBe(tools);
  });

  test("onToken callback is forwarded to the inner provider", async () => {
    const provider = new ModelCapabilityProvider(inner, "llama3.2");
    const onToken = mock((_token: string, _isReasoning: boolean) => {});

    await provider.chat([], "prompt", undefined, undefined, onToken);

    const call = inner.chat.mock.calls[0] as any[];
    expect(call[4]).toBe(onToken);
  });
});
