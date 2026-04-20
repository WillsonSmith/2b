import { test, expect, describe, mock } from "bun:test";
import { BaseAgent } from "../core/BaseAgent";
import { YieldPlugin } from "./YieldPlugin";
import type { LLMProvider } from "../providers/llm/LLMProvider";
import type { AgentConfig } from "../core/types";

function makeLLM(response = "ok"): LLMProvider {
  return {
    chat: mock(async () => ({
      response,
      nonReasoningContent: response,
      reasoningContent: "",
      reasoningText: "",
    })),
    embed: mock(async () => []),
  } as unknown as LLMProvider;
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    model: "test",
    systemPrompt: "You are a test agent.",
    heartbeatInterval: 100000,
    ...overrides,
  };
}

function waitForEvent(agent: BaseAgent, event: string, timeoutMs = 300): Promise<unknown[]> {
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

// ── YieldPlugin registration ───────────────────────────────────────────────────

describe("YieldPlugin - registration", () => {
  test("exposes yield_control tool", () => {
    const plugin = new YieldPlugin();
    const tools = plugin.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("yield_control");
  });

  test("getSystemPromptFragment returns non-empty string", () => {
    const plugin = new YieldPlugin();
    const fragment = plugin.getSystemPromptFragment();
    expect(typeof fragment).toBe("string");
    expect(fragment.length).toBeGreaterThan(0);
    expect(fragment).toContain("yield_control");
  });

  test("executeTool returns undefined for unknown tool names", async () => {
    const plugin = new YieldPlugin();
    const agent = new BaseAgent(makeLLM(), makeConfig());
    plugin.onInit(agent);
    const result = await plugin.executeTool("other_tool", {});
    expect(result).toBeUndefined();
  });

  test("executeTool throws if onInit was not called", async () => {
    const plugin = new YieldPlugin();
    await expect(
      plugin.executeTool("yield_control", { reason: "test" }),
    ).rejects.toThrow("not initialized");
  });
});

// ── yieldControl integration ───────────────────────────────────────────────────

describe("YieldPlugin - yield_control tool integration", () => {
  test("yield_control emits agent_yield event", async () => {
    const plugin = new YieldPlugin();
    const agent = new BaseAgent(makeLLM(), makeConfig());
    plugin.onInit(agent);

    const yieldPromise = waitForEvent(agent, "agent_yield");

    // Call executeTool without awaiting — it suspends until addDirect resolves it.
    const toolPromise = plugin.executeTool("yield_control", { reason: "need more info" });

    // Wait for the yield event to fire.
    await yieldPromise;

    // Resolve the yield by supplying continuation input.
    agent.addDirect("continue with this");
    const result = await toolPromise;
    expect(result).toContain("continue with this");
    agent.stop();
  });

  test("yield_control emits speak with partial_result before suspending", async () => {
    const plugin = new YieldPlugin();
    const agent = new BaseAgent(makeLLM(), makeConfig());
    plugin.onInit(agent);

    const speaks: string[] = [];
    agent.on("speak", (text) => speaks.push(text));

    const toolPromise = plugin.executeTool("yield_control", {
      reason: "need clarification",
      partial_result: "Here is what I have so far: step 1 complete.",
    });

    // Wait briefly for the emit.
    await new Promise((r) => setTimeout(r, 10));
    expect(speaks).toContain("Here is what I have so far: step 1 complete.");

    agent.addDirect("proceed");
    await toolPromise;
    agent.stop();
  });

  test("yield_control resolves with the continuation text", async () => {
    const plugin = new YieldPlugin();
    const agent = new BaseAgent(makeLLM(), makeConfig());
    plugin.onInit(agent);

    const toolPromise = plugin.executeTool("yield_control", { reason: "waiting" });

    // Short delay to let the yield set up.
    await new Promise((r) => setTimeout(r, 10));
    agent.addDirect("user said hello");

    const result = await toolPromise;
    expect(result).toContain("user said hello");
    agent.stop();
  });

  test("interrupt rejects the yield promise", async () => {
    const plugin = new YieldPlugin();
    const agent = new BaseAgent(makeLLM(), makeConfig());
    plugin.onInit(agent);

    // Start a fake tick so the AbortController is created.
    // We need to manually set up an AbortController to simulate an in-flight turn.
    // Access via the internal field by triggering a real tick.
    agent.addDirect("start"); // triggers tick, creates AbortController

    // Wait a tiny bit for the tick to start thinking.
    await new Promise((r) => setTimeout(r, 5));

    // Now call the tool — by this point the tick's AbortController is active.
    // We have to do this without waiting on the tick since we're simulating
    // a tool being called mid-turn. Use the plugin's raw executeTool.
    // For simplicity, call yieldControl directly on the agent.
    const yieldPromise = agent.yieldControl();

    // Interrupt should reject the yield promise.
    agent.interrupt();

    await expect(yieldPromise).rejects.toThrow("Yield interrupted");
    agent.stop();
  });
});
