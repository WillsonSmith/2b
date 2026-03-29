import { test, expect, describe, mock, afterEach } from "bun:test";
import { BaseAgent } from "./BaseAgent";
import type { AgentPlugin } from "./Plugin";
import type { LLMProvider } from "../providers/llm/LLMProvider";
import { AutoApprovePermissionManager, AutoDenyPermissionManager } from "./PermissionManager";
import type { AgentConfig } from "./types";

// Helper: wait for an agent event, optionally filtering by first argument value
function waitForEvent(
  agent: BaseAgent,
  event: string,
  timeoutMs = 200,
  value?: unknown,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'${value !== undefined ? ` (value=${value})` : ""}`)), timeoutMs);
    const handler = (...args: unknown[]) => {
      if (value !== undefined && args[0] !== value) return;
      clearTimeout(t);
      agent.off(event as any, handler);
      resolve(args);
    };
    agent.on(event as any, handler);
  });
}

// Wait for the agent to return to idle after processing
function waitForIdle(agent: BaseAgent, timeoutMs = 500): Promise<unknown[]> {
  return waitForEvent(agent, "state_change", timeoutMs, "idle");
}

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
    heartbeatInterval: 100000, // effectively disabled for tests
    ...overrides,
  };
}

afterEach(() => {
  // No global cleanup needed — agents are stopped in each test
});

describe("BaseAgent - input queues", () => {
  test("addDirect triggers immediate tick and LLM is called", async () => {
    const llm = makeLLM("direct reply");
    const agent = new BaseAgent(llm, makeConfig());

    const speakPromise = waitForEvent(agent, "speak");
    agent.addDirect("hello");

    const [reply] = await speakPromise;
    expect(reply).toBe("direct reply");
    agent.stop();
  });

  test("addAmbient without forceTick does not trigger immediate LLM call", async () => {
    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());

    agent.addAmbient("background noise");
    // Give it a moment — no tick should fire
    await new Promise((r) => setTimeout(r, 20));
    expect((llm.chat as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
    agent.stop();
  });

  test("addAmbient with forceTick triggers tick", async () => {
    const llm = makeLLM("ambient handled");
    const agent = new BaseAgent(llm, makeConfig());

    agent.addAmbient("something important", { forceTick: true });
    await waitForIdle(agent);

    expect((llm.chat as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    agent.stop();
  });

  test("ambient input with [IGNORE] response does not emit speak", async () => {
    const llm = makeLLM("[IGNORE]");
    const agent = new BaseAgent(llm, makeConfig());

    const speakFired = mock(() => {});
    agent.on("speak", speakFired);

    agent.addAmbient("background", { forceTick: true });
    // Wait for tick to complete via state_change idle event
    await waitForIdle(agent);
    await new Promise((r) => setTimeout(r, 20));

    expect(speakFired).not.toHaveBeenCalled();
    agent.stop();
  });

  test("direct input: [IGNORE] in response is still spoken (mustRespond=true)", async () => {
    const llm = makeLLM("[IGNORE] I must respond anyway");
    const agent = new BaseAgent(llm, makeConfig());

    const [reply] = await Promise.all([
      waitForEvent(agent, "speak").then((args) => args[0]),
      Promise.resolve().then(() => agent.addDirect("tell me")),
    ]);
    // Since mustRespond=true, [IGNORE] check is skipped — response is spoken
    expect(reply).toBe("[IGNORE] I must respond anyway");
    agent.stop();
  });
});

describe("BaseAgent - plugin lifecycle", () => {
  test("start() calls onInit on all plugins", async () => {
    const llm = makeLLM();
    const onInit1 = mock(() => {});
    const onInit2 = mock(() => {});
    const p1: AgentPlugin = { name: "P1", onInit: onInit1 };
    const p2: AgentPlugin = { name: "P2", onInit: onInit2 };
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(p1);
    agent.registerPlugin(p2);
    await agent.start();
    expect(onInit1).toHaveBeenCalledTimes(1);
    expect(onInit2).toHaveBeenCalledTimes(1);
    await agent.stop();
  });

  test("synchronous onInit error propagates out of start() (documents actual behaviour)", async () => {
    const llm = makeLLM();
    const badPlugin: AgentPlugin = {
      name: "Bad",
      onInit: () => { throw new Error("sync init failure"); },
    };
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(badPlugin);
    await expect(agent.start()).rejects.toThrow("sync init failure");
    await agent.stop();
  });

  test("plugin onError is called when LLM throws", async () => {
    const llm = {
      chat: mock(async () => { throw new Error("LLM failed"); }),
      embed: mock(async () => []),
    } as unknown as LLMProvider;

    const onError = mock((_err: Error) => {});
    const plugin: AgentPlugin = { name: "P", onError };
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);

    const errorPromise = waitForEvent(agent, "error");
    agent.addDirect("fail");
    await errorPromise;

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    agent.stop();
  });

  test("plugin onError throwing does not propagate to caller", async () => {
    const llm = {
      chat: mock(async () => { throw new Error("LLM boom"); }),
      embed: mock(async () => []),
    } as unknown as LLMProvider;

    const plugin: AgentPlugin = {
      name: "BadErrorHandler",
      onError: () => { throw new Error("secondary explosion"); },
    };
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);

    // If onError throws and propagates, the error event would carry the secondary error
    // The agent should swallow the secondary error
    const [err] = await (() => {
      const p = waitForEvent(agent, "error");
      agent.addDirect("trigger");
      return p;
    })() as [Error];

    // Original LLM error is emitted; secondary error is swallowed
    expect((err as Error).message).toBe("LLM boom");
    agent.stop();
  });
});

describe("BaseAgent - system prompt assembly", () => {
  test("system prompt includes base config prompt", async () => {
    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig({ systemPrompt: "BASE_PROMPT" }));
    agent.addDirect("hi");
    await waitForIdle(agent);
    const systemPrompt: string = (llm.chat as ReturnType<typeof mock>).mock.calls[0][1];
    expect(systemPrompt).toContain("BASE_PROMPT");
    agent.stop();
  });

  test("system prompt contains all plugin fragments", async () => {
    const llm = makeLLM();
    const p1: AgentPlugin = { name: "P1", getSystemPromptFragment: () => "FRAG_ONE" };
    const p2: AgentPlugin = { name: "P2", getSystemPromptFragment: () => "FRAG_TWO" };
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(p1).registerPlugin(p2);
    agent.addDirect("hi");
    await waitForIdle(agent);
    const systemPrompt: string = (llm.chat as ReturnType<typeof mock>).mock.calls[0][1];
    expect(systemPrompt).toContain("FRAG_ONE");
    expect(systemPrompt).toContain("FRAG_TWO");
    agent.stop();
  });

  test("system prompt contains plugin context", async () => {
    const llm = makeLLM();
    const p: AgentPlugin = { name: "CtxPlugin", getContext: async () => "PLUGIN_CONTEXT" };
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(p);
    agent.addDirect("hi");
    await waitForIdle(agent);
    const systemPrompt: string = (llm.chat as ReturnType<typeof mock>).mock.calls[0][1];
    expect(systemPrompt).toContain("PLUGIN_CONTEXT");
    agent.stop();
  });
});

describe("BaseAgent - tool collection and permission checks", () => {
  test("tool with permission=none bypasses permission manager", async () => {
    const executeTool = mock(async () => "result");
    const plugin: AgentPlugin = {
      name: "P",
      getTools: () => [{ name: "free_tool", description: "", parameters: {}, permission: "none" }],
      executeTool,
    };
    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);
    agent.addDirect("hi");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0][3];
    await tools[0].implementation({});
    expect(executeTool).toHaveBeenCalled();
    agent.stop();
  });

  test("tool with permission and AutoDenyPermissionManager is denied", async () => {
    const executeTool = mock(async () => "result");
    const plugin: AgentPlugin = {
      name: "P",
      getTools: () => [{ name: "secure_tool", description: "", parameters: {}, permission: "per_call" }],
      executeTool,
    };
    const llm = makeLLM();
    const pm = new AutoDenyPermissionManager();
    const agent = new BaseAgent(llm, makeConfig({ permissionManager: pm }));
    agent.registerPlugin(plugin);
    agent.addDirect("hi");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0][3];
    const result = await tools[0].implementation({});
    expect(executeTool).not.toHaveBeenCalled();
    expect(result).toEqual({ error: "Permission denied by user." });
    agent.stop();
  });

  test("tool with permission and AutoApprovePermissionManager is allowed", async () => {
    const executeTool = mock(async () => "approved");
    const plugin: AgentPlugin = {
      name: "P",
      getTools: () => [{ name: "secure_tool", description: "", parameters: {}, permission: "per_call" }],
      executeTool,
    };
    const llm = makeLLM();
    const pm = new AutoApprovePermissionManager();
    const agent = new BaseAgent(llm, makeConfig({ permissionManager: pm }));
    agent.registerPlugin(plugin);
    agent.addDirect("hi");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0][3];
    const result = await tools[0].implementation({ x: 1 });
    expect(executeTool).toHaveBeenCalledWith("secure_tool", { x: 1 });
    expect(result).toBe("approved");
    agent.stop();
  });

  test("tool call emits tool_call event", async () => {
    const executeTool = mock(async () => "r");
    const plugin: AgentPlugin = {
      name: "P",
      getTools: () => [{ name: "my_tool", description: "", parameters: {}, permission: "none" }],
      executeTool,
    };
    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);

    const toolCallEvents: Array<[string, Record<string, unknown>]> = [];
    agent.on("tool_call", (name, args) => toolCallEvents.push([name, args]));

    agent.addDirect("hi");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0][3];
    await tools[0].implementation({ a: 1 });

    expect(toolCallEvents).toEqual([["my_tool", { a: 1 }]]);
    agent.stop();
  });
});

describe("BaseAgent - queue re-queuing on error", () => {
  test("direct queue items are re-queued when LLM throws", async () => {
    let callCount = 0;
    const llm = {
      chat: mock(async () => {
        callCount++;
        if (callCount === 1) throw new Error("transient error");
        return { response: "ok", nonReasoningContent: "ok", reasoningContent: "", reasoningText: "" };
      }),
      embed: mock(async () => []),
    } as unknown as LLMProvider;

    const agent = new BaseAgent(llm, makeConfig());

    // First call fails
    const errorPromise = waitForEvent(agent, "error");
    agent.addDirect("message");
    await errorPromise;

    // Items should be back in queue — trigger another tick
    const speakPromise = waitForEvent(agent, "speak");
    agent.addDirect(""); // Second direct triggers tick; combined with re-queued "message"
    const [reply] = await speakPromise;
    expect(reply).toBe("ok");
    expect(callCount).toBe(2);
    agent.stop();
  });
});

describe("BaseAgent - token streaming callback", () => {
  test("tokenCallback is passed to llm.chat", async () => {
    const llm = makeLLM("response");
    const agent = new BaseAgent(llm, makeConfig());
    const tokenCb = mock((_token: string, _isReasoning: boolean) => {});
    agent.setTokenCallback(tokenCb);

    agent.addDirect("hi");
    await waitForIdle(agent);

    // The 5th argument to chat() is the tokenCallback
    const chatArgs = (llm.chat as ReturnType<typeof mock>).mock.calls[0];
    expect(chatArgs[4]).toBe(tokenCb);
    agent.stop();
  });
});

describe("BaseAgent - tick scheduling", () => {
  test("scheduleTick fires at heartbeatInterval", async () => {
    const llm = makeLLM("timed");
    const agent = new BaseAgent(llm, makeConfig({ heartbeatInterval: 50 }));
    // Start without any input — heartbeat tick should NOT call LLM (no queue items)
    await agent.start();
    await new Promise((r) => setTimeout(r, 80));
    // No input queued, so chat should not have been called
    expect((llm.chat as ReturnType<typeof mock>).mock.calls).toHaveLength(0);
    await agent.stop();
  });

  test("heartbeat fires and processes queued ambient input", async () => {
    const llm = makeLLM("[IGNORE]");
    const agent = new BaseAgent(llm, makeConfig({ heartbeatInterval: 50 }));
    await agent.start();

    agent.addAmbient("a soft sound"); // No forceTick
    // Wait for the tick to fire and complete (idle state)
    await waitForIdle(agent, 500);

    expect((llm.chat as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
    await agent.stop();
  });
});
