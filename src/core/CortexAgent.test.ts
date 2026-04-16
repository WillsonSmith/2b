import { test, expect, describe, mock } from "bun:test";
import { CortexAgent } from "./CortexAgent";
import { CortexMemoryPlugin } from "../plugins/CortexMemoryPlugin";
import type { AgentPlugin } from "./Plugin";
import type { LLMProvider } from "../providers/llm/LLMProvider";

function makeLLM(response = "[IGNORE]"): LLMProvider {
  return {
    chat: mock(async () => ({
      response,
      nonReasoningContent: response,
      reasoningContent: "",
      reasoningText: "",
    })),
    embed: mock(async (_text: string) => new Array(64).fill(0)),
  } as unknown as LLMProvider;
}

/** Shared base config — all tests use in-memory SQLite. */
const BASE_CONFIG = {
  model: "test",
  systemPrompt: "base",
  memoryDbPath: ":memory:",
} as const;

// Wait for an event on a CortexAgent
function waitForEvent(agent: CortexAgent, event: string, timeoutMs = 500): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeoutMs);
    const handler = (...args: unknown[]) => {
      clearTimeout(t);
      agent.off(event as any, handler);
      resolve(args);
    };
    agent.on(event as any, handler);
  });
}

function waitForIdle(agent: CortexAgent, timeoutMs = 500): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Timeout waiting for idle")), timeoutMs);
    const handler = (state: string) => {
      if (state !== "idle") return;
      clearTimeout(t);
      agent.off("state_change" as any, handler);
      resolve([state]);
    };
    agent.on("state_change" as any, handler);
  });
}

describe("CortexAgent - plugin registration", () => {
  test("memoryPlugin is a CortexMemoryPlugin instance", () => {
    const llm = makeLLM();
    const agent = new CortexAgent(llm, BASE_CONFIG);
    expect(agent.memoryPlugin).toBeInstanceOf(CortexMemoryPlugin);
  });

  test("system prompt includes CortexMemoryPlugin fragment even with no extra plugins", async () => {
    const llm = makeLLM();
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, heartbeatInterval: 100000 });

    agent.addDirect("hi");
    await waitForIdle(agent);

    const systemPrompt: string = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![1];
    expect(systemPrompt).toContain("## Memory System");
    agent.stop();
  });

  test("system prompt includes ThoughtPlugin fragment even with no extra plugins", async () => {
    const llm = makeLLM();
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, heartbeatInterval: 100000 });

    agent.addDirect("hi");
    await waitForIdle(agent);

    const systemPrompt: string = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![1];
    expect(systemPrompt).toContain("## Internal Reasoning");
    agent.stop();
  });

  test("tools include get_recent_thoughts from ThoughtPlugin", async () => {
    const llm = makeLLM();
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, heartbeatInterval: 100000 });

    agent.addDirect("hi");
    await waitForIdle(agent);

    const tools: Array<{ name: string }> = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3] ?? [];
    expect(tools.map((t) => t.name)).toContain("get_recent_thoughts");
    agent.stop();
  });

  test("tools include search_memory from CortexMemoryPlugin", async () => {
    const llm = makeLLM();
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, heartbeatInterval: 100000 });

    agent.addDirect("hi");
    await waitForIdle(agent);

    const tools: Array<{ name: string }> = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3] ?? [];
    expect(tools.map((t) => t.name)).toContain("search_memory");
    agent.stop();
  });

  test("additional plugins passed via registerPlugin are also included", async () => {
    const llm = makeLLM();
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, heartbeatInterval: 100000 });

    const extraPlugin: AgentPlugin = {
      name: "ExtraPlugin",
      getSystemPromptFragment: () => "EXTRA_FRAGMENT",
    };
    agent.registerPlugin(extraPlugin);

    agent.addDirect("hi");
    await waitForIdle(agent);

    const systemPrompt: string = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![1];
    expect(systemPrompt).toContain("EXTRA_FRAGMENT");
    agent.stop();
  });
});

describe("CortexAgent - cortexName fallback", () => {
  test("cortexName is preferred when set", () => {
    const llm = makeLLM();
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, name: "myAgent", cortexName: "explicit" });
    expect(agent.memoryPlugin).toBeInstanceOf(CortexMemoryPlugin);
  });

  test("falls back to name when cortexName is not set", () => {
    const llm = makeLLM();
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, name: "myAgent" });
    expect(agent.memoryPlugin).toBeInstanceOf(CortexMemoryPlugin);
  });

  test("falls back to 'cortex' when neither cortexName nor name is set", () => {
    const llm = makeLLM();
    const agent = new CortexAgent(llm, BASE_CONFIG);
    expect(agent.memoryPlugin).toBeInstanceOf(CortexMemoryPlugin);
  });
});

describe("CortexAgent - event forwarding", () => {
  test("speak event fires through on()", async () => {
    const llm = makeLLM("hello world");
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, heartbeatInterval: 100000 });

    const speakPromise = waitForEvent(agent, "speak");
    agent.addDirect("hi");

    const [reply] = await speakPromise;
    expect(reply).toBe("hello world");
    agent.stop();
  });

  test("once() fires exactly once", async () => {
    const llm = makeLLM("reply");
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, heartbeatInterval: 100000 });

    const handler = mock((_reply: string) => {});
    agent.once("speak" as any, handler);

    agent.addDirect("first");
    await waitForIdle(agent);
    agent.addDirect("second");
    await waitForIdle(agent);

    expect(handler).toHaveBeenCalledTimes(1);
    agent.stop();
  });

  test("off() unsubscribes the listener", async () => {
    const llm = makeLLM("reply");
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, heartbeatInterval: 100000 });

    const handler = mock((_reply: string) => {});
    agent.on("speak" as any, handler);
    agent.off("speak" as any, handler);

    agent.addDirect("trigger");
    await waitForIdle(agent);

    expect(handler).not.toHaveBeenCalled();
    agent.stop();
  });

  test("addAmbient and addDirect are forwarded to inner agent", async () => {
    const llm = makeLLM("[IGNORE]");
    const agent = new CortexAgent(llm, { ...BASE_CONFIG, heartbeatInterval: 100000 });

    agent.addAmbient("background", { forceTick: true });
    await waitForIdle(agent);

    expect((llm.chat as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    agent.stop();
  });
});
