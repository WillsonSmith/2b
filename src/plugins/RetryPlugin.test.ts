import { test, expect, describe, mock, beforeEach } from "bun:test";
import { BaseAgent } from "../core/BaseAgent";
import { RetryPlugin } from "./RetryPlugin";
import type { AgentPlugin, ToolDefinition } from "../core/Plugin";
import type { LLMProvider } from "../providers/llm/LLMProvider";
import type { AgentConfig } from "../core/types";

// ── Test helpers ───────────────────────────────────────────────────────────────

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

function waitForEvent(agent: BaseAgent, event: string, timeoutMs = 400): Promise<unknown[]> {
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

function waitForIdle(agent: BaseAgent, timeoutMs = 500): Promise<unknown[]> {
  return waitForEvent(agent, "state_change", timeoutMs);
}

// ── RetryPlugin registration ───────────────────────────────────────────────────

describe("RetryPlugin - registration", () => {
  test("exposes retry_tool", () => {
    const plugin = new RetryPlugin();
    const tools = plugin.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("retry_tool");
  });

  test("getSystemPromptFragment mentions retry_tool", () => {
    const fragment = new RetryPlugin().getSystemPromptFragment();
    expect(fragment).toContain("retry_tool");
  });

  test("executeTool returns undefined for unknown tool name", async () => {
    const plugin = new RetryPlugin();
    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(plugin);
    await agent.start();
    const result = await plugin.executeTool("unknown_tool", {});
    expect(result).toBeUndefined();
    agent.stop();
  });

  test("executeTool throws if onInit was not called", async () => {
    const plugin = new RetryPlugin();
    await expect(
      plugin.executeTool("retry_tool", { tool_name: "x", reason: "test" }),
    ).rejects.toThrow("not initialized");
  });
});

// ── dispatchTool ───────────────────────────────────────────────────────────────

describe("BaseAgent.dispatchTool", () => {
  test("routes call to the correct plugin", async () => {
    const executeTool = mock(async () => "dispatch result");
    const plugin: AgentPlugin = {
      name: "P",
      getTools: () => [{ name: "my_tool", description: "", parameters: {} }],
      executeTool,
    };
    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(plugin);

    const result = await agent.dispatchTool("my_tool", { x: 1 });
    expect(result).toBe("dispatch result");
    expect(executeTool).toHaveBeenCalledWith("my_tool", { x: 1 });
  });

  test("returns error string for unknown tool name", async () => {
    const agent = new BaseAgent(makeLLM(), makeConfig());
    const result = await agent.dispatchTool("nonexistent", {});
    expect(typeof result).toBe("string");
    expect(result as string).toContain("nonexistent");
  });

  test("routes to first plugin that declares the tool", async () => {
    const execA = mock(async () => "from A");
    const execB = mock(async () => "from B");
    const pluginA: AgentPlugin = {
      name: "A",
      getTools: () => [{ name: "shared_tool", description: "", parameters: {} }],
      executeTool: execA,
    };
    const pluginB: AgentPlugin = {
      name: "B",
      getTools: () => [{ name: "shared_tool", description: "", parameters: {} }],
      executeTool: execB,
    };
    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(pluginA);
    agent.registerPlugin(pluginB);

    const result = await agent.dispatchTool("shared_tool", {});
    expect(result).toBe("from A");
    expect(execA).toHaveBeenCalledTimes(1);
    expect(execB).toHaveBeenCalledTimes(0);
  });
});

// ── retry_tool (RetryPlugin) ───────────────────────────────────────────────────

describe("retry_tool - RetryPlugin", () => {
  test("re-invokes the named tool via dispatchTool", async () => {
    const targetExec = mock(async () => "target result");
    const targetPlugin: AgentPlugin = {
      name: "Target",
      getTools: () => [{ name: "target", description: "", parameters: {} }],
      executeTool: targetExec,
    };

    const retryPlugin = new RetryPlugin();
    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(targetPlugin);
    agent.registerPlugin(retryPlugin);
    await agent.start();

    const result = await retryPlugin.executeTool("retry_tool", {
      tool_name: "target",
      reason: "transient error",
    });
    expect(result).toBe("target result");
    expect(targetExec).toHaveBeenCalledTimes(1);
    agent.stop();
  });

  test("passes args through to the retried tool", async () => {
    const targetExec = mock(async (_name: string, args: any) => `got ${args.x}`);
    const targetPlugin: AgentPlugin = {
      name: "T",
      getTools: () => [{ name: "echo", description: "", parameters: {} }],
      executeTool: targetExec,
    };

    const retryPlugin = new RetryPlugin();
    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(targetPlugin);
    agent.registerPlugin(retryPlugin);
    await agent.start();

    const result = await retryPlugin.executeTool("retry_tool", {
      tool_name: "echo",
      args: { x: 42 },
      reason: "retry with new args",
    });
    expect(result).toBe("got 42");
    agent.stop();
  });

  test("returns error string from dispatchTool when tool not found", async () => {
    const retryPlugin = new RetryPlugin();
    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(retryPlugin);
    await agent.start();

    const result = await retryPlugin.executeTool("retry_tool", {
      tool_name: "nonexistent",
      reason: "test",
    }) as string;
    expect(result).toContain("nonexistent");
    agent.stop();
  });

  test("returns error when tool_name is missing", async () => {
    const retryPlugin = new RetryPlugin();
    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(retryPlugin);
    await agent.start();

    const result = await retryPlugin.executeTool("retry_tool", {
      reason: "missing tool_name",
    }) as string;
    expect(result).toContain("tool_name");
    agent.stop();
  });
});

// ── Automatic retry policy in buildTools ──────────────────────────────────────

describe("ToolDefinition.retry - automatic retry in buildTools", () => {
  test("retries on error up to maxAttempts times", async () => {
    let callCount = 0;
    const executeTool = mock(async () => {
      callCount++;
      if (callCount < 3) throw new Error("transient");
      return "success on third";
    });

    const plugin: AgentPlugin = {
      name: "P",
      getTools: (): ToolDefinition[] => [{
        name: "flaky",
        description: "",
        parameters: {},
        retry: { maxAttempts: 3 },
      }],
      executeTool,
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);
    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    const result = await tools[0].implementation({});
    expect(result).toBe("success on third");
    expect(callCount).toBe(3);
    agent.stop();
  });

  test("returns error string after all attempts exhausted", async () => {
    const executeTool = mock(async () => { throw new Error("always fails"); });

    const plugin: AgentPlugin = {
      name: "P",
      getTools: (): ToolDefinition[] => [{
        name: "fail_tool",
        description: "",
        parameters: {},
        retry: { maxAttempts: 2 },
      }],
      executeTool,
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);
    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    const result = await tools[0].implementation({}) as string;
    expect(result).toContain("always fails");
    expect(result).toContain("2 attempt(s)");
    expect(executeTool).toHaveBeenCalledTimes(2);
    agent.stop();
  });

  test("does not retry when retryOn predicate returns false", async () => {
    const executeTool = mock(async () => { throw new Error("non-retryable"); });

    const plugin: AgentPlugin = {
      name: "P",
      getTools: (): ToolDefinition[] => [{
        name: "guarded",
        description: "",
        parameters: {},
        retry: { maxAttempts: 3, retryOn: () => false },
      }],
      executeTool,
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);
    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    await tools[0].implementation({});
    // retryOn returned false, so only 1 attempt despite maxAttempts: 3
    expect(executeTool).toHaveBeenCalledTimes(1);
    agent.stop();
  });

  test("retries only matching errors when retryOn is selective", async () => {
    let callCount = 0;
    const executeTool = mock(async () => {
      callCount++;
      throw new Error(callCount === 1 ? "transient" : "fatal");
    });

    const plugin: AgentPlugin = {
      name: "P",
      getTools: (): ToolDefinition[] => [{
        name: "selective",
        description: "",
        parameters: {},
        retry: {
          maxAttempts: 5,
          retryOn: (e) => e instanceof Error && e.message === "transient",
        },
      }],
      executeTool,
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);
    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    const result = await tools[0].implementation({}) as string;
    // First attempt: transient → retry. Second: fatal → retryOn returns false → stop.
    expect(callCount).toBe(2);
    expect(result).toContain("fatal");
    agent.stop();
  });

  test("no retry when retry field is absent — executeTool called exactly once", async () => {
    const executeTool = mock(async () => { throw new Error("one and done"); });

    const plugin: AgentPlugin = {
      name: "P",
      getTools: (): ToolDefinition[] => [{ name: "t", description: "", parameters: {} }],
      executeTool,
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);
    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    // Without retry policy, maxAttempts defaults to 1 → error caught and returned as string
    const result = await tools[0].implementation({}) as string;
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result).toContain("one and done");
    agent.stop();
  });

  test("emits log event on each retry", async () => {
    let callCount = 0;
    const executeTool = mock(async () => {
      callCount++;
      if (callCount < 3) throw new Error("retry me");
      return "done";
    });

    const plugin: AgentPlugin = {
      name: "P",
      getTools: (): ToolDefinition[] => [{
        name: "logged",
        description: "",
        parameters: {},
        retry: { maxAttempts: 3 },
      }],
      executeTool,
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);

    const logs: string[] = [];
    agent.on("log", (msg) => logs.push(msg));

    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    await tools[0].implementation({});

    const retryLogs = logs.filter(l => l.includes("[Retry]"));
    expect(retryLogs.length).toBe(2); // attempts 2 and 3
    agent.stop();
  });

  test("exponential backoff doubles delay per attempt", async () => {
    const delays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    let callCount = 0;

    const executeTool = mock(async () => {
      callCount++;
      if (callCount < 3) throw new Error("fail");
      return "ok";
    });

    const plugin: AgentPlugin = {
      name: "P",
      getTools: (): ToolDefinition[] => [{
        name: "backoff_tool",
        description: "",
        parameters: {},
        retry: { maxAttempts: 3, delayMs: 10, backoff: "exponential" },
      }],
      executeTool,
    };

    // Intercept setTimeout to capture delay values without actually waiting
    (globalThis as any).setTimeout = (fn: () => void, ms?: number) => {
      if (typeof ms === "number" && ms > 0) delays.push(ms);
      return origSetTimeout(fn, 0); // execute immediately in tests
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);
    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    await tools[0].implementation({});

    (globalThis as any).setTimeout = origSetTimeout;

    // attempt 2: 10 * 2^0 = 10, attempt 3: 10 * 2^1 = 20
    expect(delays).toContain(10);
    expect(delays).toContain(20);
    agent.stop();
  });
});
