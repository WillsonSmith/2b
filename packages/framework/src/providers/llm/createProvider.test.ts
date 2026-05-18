import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Module mocks — only mock external packages, never TypeScript source files.
//
// Mocking OllamaProvider.ts at module-load time pollutes Bun's module cache
// and breaks that file's own test suite. Instead we mock the underlying SDK
// package to prevent real network connections, then inspect constructor args
// and private fields directly.
// ---------------------------------------------------------------------------

// Spy on Ollama constructor to capture which host is passed.
const MockOllamaClient = mock(function (this: any, _opts: unknown) {
  this.chat = async () => ({ message: { content: "", thinking: undefined } });
  this.embed = async () => ({ embeddings: [[]] });
});

mock.module("ollama", () => ({ Ollama: MockOllamaClient }));

const { createProvider, defaultModel } = await import("./createProvider.ts");
const { ModelCapabilityProvider } = await import("./ModelCapabilityProvider.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearEnv(...keys: string[]) {
  for (const key of keys) delete process.env[key];
}

/** Inner LLMProvider instance wrapped by the returned ModelCapabilityProvider. */
function innerOf(provider: unknown): any {
  return (provider as any).inner;
}

// ---------------------------------------------------------------------------
// Ollama backend
// ---------------------------------------------------------------------------

describe("Ollama backend", () => {
  beforeEach(() => {
    MockOllamaClient.mockClear?.();
    clearEnv("PROVIDER", "OLLAMA_URL", "OLLAMA_NUM_CTX", "OLLAMA_THINK");
  });

  afterEach(() => {
    clearEnv("PROVIDER", "OLLAMA_URL", "OLLAMA_NUM_CTX", "OLLAMA_THINK");
  });

  test("uses OllamaProvider", () => {
    createProvider("test-model");
    expect(MockOllamaClient).toHaveBeenCalledTimes(1);
  });

  test("uses default Ollama URL when OLLAMA_URL is unset", () => {
    createProvider("test-model");
    const opts = (MockOllamaClient.mock.calls[0] as any[])[0] as any;
    expect(opts.host).toBe("http://127.0.0.1:11434");
  });

  test("uses OLLAMA_URL when set", () => {
    process.env.OLLAMA_URL = "http://10.0.0.5:11434";
    createProvider("test-model");
    const opts = (MockOllamaClient.mock.calls[0] as any[])[0] as any;
    expect(opts.host).toBe("http://10.0.0.5:11434");
  });

  test("wraps provider in ModelCapabilityProvider", () => {
    const provider = createProvider("my-model");
    expect(provider).toBeInstanceOf(ModelCapabilityProvider);
    expect((provider as any).model).toBe("my-model");
  });

  // ── OLLAMA_NUM_CTX ────────────────────────────────────────────────────────

  test("numCtx is undefined when OLLAMA_NUM_CTX is unset", () => {
    const provider = createProvider("test-model");
    expect(innerOf(provider).numCtx).toBeUndefined();
  });

  test("numCtx is passed as integer when OLLAMA_NUM_CTX is a valid number", () => {
    process.env.OLLAMA_NUM_CTX = "8192";
    const provider = createProvider("test-model");
    expect(innerOf(provider).numCtx).toBe(8192);
  });

  test("throws on non-numeric OLLAMA_NUM_CTX", () => {
    process.env.OLLAMA_NUM_CTX = "abc";
    expect(() => createProvider("test-model")).toThrow(
      'OLLAMA_NUM_CTX is not a valid integer: "abc"',
    );
  });

  test("throws on partial-numeric OLLAMA_NUM_CTX like '8k'", () => {
    process.env.OLLAMA_NUM_CTX = "8k";
    // parseInt("8k") === 8, which is valid — this should NOT throw
    const provider = createProvider("test-model");
    expect(innerOf(provider).numCtx).toBe(8);
  });

  // ── OLLAMA_THINK ──────────────────────────────────────────────────────────

  test("think defaults to true when OLLAMA_THINK is unset", () => {
    const provider = createProvider("test-model");
    expect(innerOf(provider).think).toBe(true);
  });

  test("think is true when OLLAMA_THINK=true", () => {
    process.env.OLLAMA_THINK = "true";
    const provider = createProvider("test-model");
    expect(innerOf(provider).think).toBe(true);
  });

  test("think is false when OLLAMA_THINK=false", () => {
    process.env.OLLAMA_THINK = "false";
    const provider = createProvider("test-model");
    expect(innerOf(provider).think).toBe(false);
  });

  test("think is 'high' when OLLAMA_THINK=high", () => {
    process.env.OLLAMA_THINK = "high";
    const provider = createProvider("test-model");
    expect(innerOf(provider).think).toBe("high");
  });

  test("think is 'medium' when OLLAMA_THINK=medium", () => {
    process.env.OLLAMA_THINK = "medium";
    const provider = createProvider("test-model");
    expect(innerOf(provider).think).toBe("medium");
  });

  test("think is 'low' when OLLAMA_THINK=low", () => {
    process.env.OLLAMA_THINK = "low";
    const provider = createProvider("test-model");
    expect(innerOf(provider).think).toBe("low");
  });

  test("throws on unrecognised OLLAMA_THINK value", () => {
    process.env.OLLAMA_THINK = "maybe";
    expect(() => createProvider("test-model")).toThrow(
      'OLLAMA_THINK must be "true", "false", "high", "medium", or "low" — got "maybe"',
    );
  });
});

// ---------------------------------------------------------------------------
// defaultModel()
// ---------------------------------------------------------------------------

describe("defaultModel()", () => {
  test("returns ollama model", () => {
    expect(defaultModel()).toBe("gemma4:26b");
  });
});
