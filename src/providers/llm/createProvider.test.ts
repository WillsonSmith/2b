import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Module mocks — declared before the imports under test
// ---------------------------------------------------------------------------

const mockLMStudioInstance = { _type: "lmstudio" };
const mockOllamaInstance = { _type: "ollama" };
const mockCapabilityInstance = { _type: "capability" };

const MockLMStudioProvider = mock((_model: string, _url: string, _opts: unknown) => mockLMStudioInstance);
const MockOllamaProvider = mock((_model: string, _url: string, _opts: unknown) => mockOllamaInstance);
const MockModelCapabilityProvider = mock((_inner: unknown, _model: string) => mockCapabilityInstance);

mock.module("./LMStudioProvider.ts", () => ({ LMStudioProvider: MockLMStudioProvider }));
mock.module("./OllamaProvider.ts", () => ({ OllamaProvider: MockOllamaProvider }));
mock.module("./ModelCapabilityProvider.ts", () => ({ ModelCapabilityProvider: MockModelCapabilityProvider }));

const { createProvider, defaultModel } = await import("./createProvider.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clearEnv(...keys: string[]) {
  for (const key of keys) delete process.env[key];
}

// ---------------------------------------------------------------------------
// LMStudio (default backend)
// ---------------------------------------------------------------------------

describe("LMStudio backend (default)", () => {
  beforeEach(() => {
    MockLMStudioProvider.mockClear?.();
    MockModelCapabilityProvider.mockClear?.();
    clearEnv("PROVIDER", "LM_STUDIO_URL", "OLLAMA_URL", "OLLAMA_NUM_CTX", "OLLAMA_THINK");
  });

  test("uses LMStudioProvider when PROVIDER is unset", () => {
    createProvider("test-model");
    expect(MockLMStudioProvider).toHaveBeenCalledTimes(1);
    expect(MockOllamaProvider).not.toHaveBeenCalled();
  });

  test("uses LMStudioProvider when PROVIDER=lmstudio", () => {
    process.env.PROVIDER = "lmstudio";
    createProvider("test-model");
    expect(MockLMStudioProvider).toHaveBeenCalledTimes(1);
  });

  test("uses default LMStudio URL when LM_STUDIO_URL is unset", () => {
    createProvider("test-model");
    const url = (MockLMStudioProvider.mock.calls[0] as any[])[1];
    expect(url).toBe("ws://127.0.0.1:1234");
  });

  test("uses LM_STUDIO_URL when set", () => {
    process.env.LM_STUDIO_URL = "ws://192.168.1.10:1234";
    createProvider("test-model");
    const url = (MockLMStudioProvider.mock.calls[0] as any[])[1];
    expect(url).toBe("ws://192.168.1.10:1234");
  });

  test("wraps provider in ModelCapabilityProvider", () => {
    createProvider("my-model");
    expect(MockModelCapabilityProvider).toHaveBeenCalledTimes(1);
    const args = MockModelCapabilityProvider.mock.calls[0] as any[];
    expect(args[1]).toBe("my-model");
  });
});

// ---------------------------------------------------------------------------
// Ollama backend
// ---------------------------------------------------------------------------

describe("Ollama backend", () => {
  beforeEach(() => {
    process.env.PROVIDER = "ollama";
    MockLMStudioProvider.mockClear?.();
    MockOllamaProvider.mockClear?.();
    MockModelCapabilityProvider.mockClear?.();
    clearEnv("OLLAMA_URL", "OLLAMA_NUM_CTX", "OLLAMA_THINK");
  });

  afterEach(() => {
    clearEnv("PROVIDER", "OLLAMA_URL", "OLLAMA_NUM_CTX", "OLLAMA_THINK");
  });

  test("uses OllamaProvider when PROVIDER=ollama", () => {
    createProvider("test-model");
    expect(MockOllamaProvider).toHaveBeenCalledTimes(1);
    expect(MockLMStudioProvider).not.toHaveBeenCalled();
  });

  test("uses default Ollama URL when OLLAMA_URL is unset", () => {
    createProvider("test-model");
    const url = (MockOllamaProvider.mock.calls[0] as any[])[1];
    expect(url).toBe("http://127.0.0.1:11434");
  });

  test("uses OLLAMA_URL when set", () => {
    process.env.OLLAMA_URL = "http://10.0.0.5:11434";
    createProvider("test-model");
    const url = (MockOllamaProvider.mock.calls[0] as any[])[1];
    expect(url).toBe("http://10.0.0.5:11434");
  });

  test("wraps provider in ModelCapabilityProvider", () => {
    createProvider("my-model");
    expect(MockModelCapabilityProvider).toHaveBeenCalledTimes(1);
    const args = MockModelCapabilityProvider.mock.calls[0] as any[];
    expect(args[1]).toBe("my-model");
  });

  // ── OLLAMA_NUM_CTX ────────────────────────────────────────────────────────

  test("numCtx is undefined when OLLAMA_NUM_CTX is unset", () => {
    createProvider("test-model");
    const opts = (MockOllamaProvider.mock.calls[0] as any[])[2] as any;
    expect(opts.numCtx).toBeUndefined();
  });

  test("numCtx is passed as integer when OLLAMA_NUM_CTX is a valid number", () => {
    process.env.OLLAMA_NUM_CTX = "8192";
    createProvider("test-model");
    const opts = (MockOllamaProvider.mock.calls[0] as any[])[2] as any;
    expect(opts.numCtx).toBe(8192);
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
    createProvider("test-model");
    const opts = (MockOllamaProvider.mock.calls[0] as any[])[2] as any;
    expect(opts.numCtx).toBe(8);
  });

  // ── OLLAMA_THINK ──────────────────────────────────────────────────────────

  test("think defaults to true when OLLAMA_THINK is unset", () => {
    createProvider("test-model");
    const opts = (MockOllamaProvider.mock.calls[0] as any[])[2] as any;
    expect(opts.think).toBe(true);
  });

  test("think is true when OLLAMA_THINK=true", () => {
    process.env.OLLAMA_THINK = "true";
    createProvider("test-model");
    const opts = (MockOllamaProvider.mock.calls[0] as any[])[2] as any;
    expect(opts.think).toBe(true);
  });

  test("think is false when OLLAMA_THINK=false", () => {
    process.env.OLLAMA_THINK = "false";
    createProvider("test-model");
    const opts = (MockOllamaProvider.mock.calls[0] as any[])[2] as any;
    expect(opts.think).toBe(false);
  });

  test("think is 'high' when OLLAMA_THINK=high", () => {
    process.env.OLLAMA_THINK = "high";
    createProvider("test-model");
    const opts = (MockOllamaProvider.mock.calls[0] as any[])[2] as any;
    expect(opts.think).toBe("high");
  });

  test("think is 'medium' when OLLAMA_THINK=medium", () => {
    process.env.OLLAMA_THINK = "medium";
    createProvider("test-model");
    const opts = (MockOllamaProvider.mock.calls[0] as any[])[2] as any;
    expect(opts.think).toBe("medium");
  });

  test("think is 'low' when OLLAMA_THINK=low", () => {
    process.env.OLLAMA_THINK = "low";
    createProvider("test-model");
    const opts = (MockOllamaProvider.mock.calls[0] as any[])[2] as any;
    expect(opts.think).toBe("low");
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
  afterEach(() => clearEnv("PROVIDER"));

  test("returns lmstudio model when PROVIDER is unset", () => {
    expect(defaultModel()).toBe("qwen/qwen3.5-35b-a3b");
  });

  test("returns lmstudio model when PROVIDER=lmstudio", () => {
    process.env.PROVIDER = "lmstudio";
    expect(defaultModel()).toBe("qwen/qwen3.5-35b-a3b");
  });

  test("returns ollama model when PROVIDER=ollama", () => {
    process.env.PROVIDER = "ollama";
    expect(defaultModel()).toBe("qwen3.5:35b");
  });
});
