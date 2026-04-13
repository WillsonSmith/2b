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

// ─────────────────────────────────────────────────────────────────────────────
// Performance: tool caching
// ─────────────────────────────────────────────────────────────────────────────

describe("BaseAgent - tool caching (perf)", () => {
  test("getTools is called only once across two ticks when no plugin is added between them", async () => {
    const getTools = mock(() => [{ name: "t", description: "", parameters: {} }]);
    const plugin: AgentPlugin = { name: "P", getTools, executeTool: mock(async () => "ok") };

    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(plugin);

    agent.addDirect("first");
    await waitForIdle(agent);
    agent.addDirect("second");
    await waitForIdle(agent);

    // Cache should have been populated on the first tick and reused on the second.
    expect(getTools).toHaveBeenCalledTimes(1);
    agent.stop();
  });

  test("getTools is called again after registerPlugin invalidates the cache", async () => {
    const getTools = mock(() => [{ name: "t", description: "", parameters: {} }]);
    const plugin: AgentPlugin = { name: "P", getTools, executeTool: mock(async () => "ok") };

    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(plugin);

    // First tick — builds cache.
    agent.addDirect("first");
    await waitForIdle(agent);
    expect(getTools).toHaveBeenCalledTimes(1);

    // Adding a second plugin invalidates cachedTools.
    agent.registerPlugin({ name: "P2", getTools: mock(() => []) });

    // Second tick — must rebuild.
    agent.addDirect("second");
    await waitForIdle(agent);
    expect(getTools).toHaveBeenCalledTimes(2);
    agent.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Performance: concurrent onInit
// ─────────────────────────────────────────────────────────────────────────────

describe("BaseAgent - concurrent plugin onInit (perf)", () => {
  test("async onInit calls from different plugins overlap in time", async () => {
    const timeline: string[] = [];

    // P1 takes 30ms; P2 takes 10ms. If sequential, P2 can only start after P1 finishes.
    // If concurrent, P2 finishes before P1.
    const p1: AgentPlugin = {
      name: "P1",
      onInit: async () => {
        timeline.push("P1:start");
        await new Promise(r => setTimeout(r, 30));
        timeline.push("P1:end");
      },
    };
    const p2: AgentPlugin = {
      name: "P2",
      onInit: async () => {
        timeline.push("P2:start");
        await new Promise(r => setTimeout(r, 10));
        timeline.push("P2:end");
      },
    };

    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(p1).registerPlugin(p2);
    await agent.start();

    // Concurrent order: P1:start → P2:start → P2:end → P1:end
    // Sequential order would be: P1:start → P1:end → P2:start → P2:end
    expect(timeline).toEqual(["P1:start", "P2:start", "P2:end", "P1:end"]);
    await agent.stop();
  });

  test("async onInit rejection in one plugin does not prevent others from initializing", async () => {
    const p2Inited = mock(() => {});

    const p1: AgentPlugin = {
      name: "P1",
      onInit: async () => { throw new Error("P1 init failed"); },
    };
    const p2: AgentPlugin = {
      name: "P2",
      onInit: async () => { p2Inited(); },
    };

    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(p1).registerPlugin(p2);

    // start() should not throw — Promise.allSettled absorbs the rejection.
    await agent.start();
    expect(p2Inited).toHaveBeenCalledTimes(1);
    await agent.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Performance: concurrent collectMessages
// ─────────────────────────────────────────────────────────────────────────────

describe("BaseAgent - concurrent collectMessages (perf)", () => {
  test("messages are assembled in plugin registration order even when a slow plugin resolves last", async () => {
    // P1 takes 30ms, P2 resolves immediately — but P1 is registered first so its
    // messages must appear before P2's in the final array.
    const p1: AgentPlugin = {
      name: "P1",
      getMessages: async () => {
        await new Promise(r => setTimeout(r, 30));
        return [{ role: "assistant" as const, content: "from-P1" }];
      },
    };
    const p2: AgentPlugin = {
      name: "P2",
      getMessages: async () => [{ role: "assistant" as const, content: "from-P2" }],
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(p1).registerPlugin(p2);
    agent.addDirect("hi");
    await waitForIdle(agent, 500);

    const messages: Array<{ role: string; content: string }> =
      (llm.chat as ReturnType<typeof mock>).mock.calls[0][0];
    const p1Idx = messages.findIndex(m => m.content === "from-P1");
    const p2Idx = messages.findIndex(m => m.content === "from-P2");
    expect(p1Idx).toBeGreaterThanOrEqual(0);
    expect(p2Idx).toBeGreaterThanOrEqual(0);
    expect(p1Idx).toBeLessThan(p2Idx);
    agent.stop();
  });

  test("a getMessages rejection in one plugin does not drop other plugins' messages", async () => {
    const p1: AgentPlugin = {
      name: "P1",
      getMessages: async () => { throw new Error("DB unavailable"); },
    };
    const p2: AgentPlugin = {
      name: "P2",
      getMessages: async () => [{ role: "assistant" as const, content: "from-P2" }],
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(p1).registerPlugin(p2);
    agent.addDirect("hi");
    await waitForIdle(agent);

    const messages: Array<{ role: string; content: string }> =
      (llm.chat as ReturnType<typeof mock>).mock.calls[0][0];
    expect(messages.some(m => m.content === "from-P2")).toBe(true);
    agent.stop();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Performance: concurrent collectSystemPrompt
// ─────────────────────────────────────────────────────────────────────────────

describe("BaseAgent - concurrent collectSystemPrompt (perf)", () => {
  test("fragments from all plugins appear in registration order despite different resolution times", async () => {
    // P1 (slow) is registered first — its fragment must still appear before P2's (fast).
    const p1: AgentPlugin = {
      name: "P1",
      getSystemPromptFragment: async () => {
        await new Promise(r => setTimeout(r, 30));
        return "FRAG_SLOW";
      },
    };
    const p2: AgentPlugin = {
      name: "P2",
      getSystemPromptFragment: async () => "FRAG_FAST",
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(p1).registerPlugin(p2);
    agent.addDirect("hi");
    await waitForIdle(agent, 500);

    const systemPrompt: string = (llm.chat as ReturnType<typeof mock>).mock.calls[0][1];
    expect(systemPrompt).toContain("FRAG_SLOW");
    expect(systemPrompt).toContain("FRAG_FAST");
    expect(systemPrompt.indexOf("FRAG_SLOW")).toBeLessThan(systemPrompt.indexOf("FRAG_FAST"));
    agent.stop();
  });

  test("within a single plugin, getSystemPromptFragment completes before getContext starts", async () => {
    // This ordering is required so that plugins can cache an embedding computed in
    // getSystemPromptFragment and reuse it in getContext (see CortexMemoryPlugin).
    const callOrder: string[] = [];

    const p: AgentPlugin = {
      name: "P",
      getSystemPromptFragment: async () => {
        callOrder.push("fragment:start");
        await new Promise(r => setTimeout(r, 20));
        callOrder.push("fragment:end");
        return "FRAG";
      },
      getContext: async () => {
        callOrder.push("context:start");
        return "CTX";
      },
    };

    const agent = new BaseAgent(makeLLM(), makeConfig());
    agent.registerPlugin(p);
    agent.addDirect("hi");
    await waitForIdle(agent, 500);

    expect(callOrder).toEqual(["fragment:start", "fragment:end", "context:start"]);
    agent.stop();
  });

  test("a getContext rejection in one plugin does not drop other plugins' context", async () => {
    const p1: AgentPlugin = {
      name: "P1",
      getContext: async () => { throw new Error("context failed"); },
    };
    const p2: AgentPlugin = {
      name: "P2",
      getContext: async () => "CTX_FROM_P2",
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(p1).registerPlugin(p2);
    agent.addDirect("hi");
    await waitForIdle(agent);

    const systemPrompt: string = (llm.chat as ReturnType<typeof mock>).mock.calls[0][1];
    expect(systemPrompt).toContain("CTX_FROM_P2");
    agent.stop();
  });
});
