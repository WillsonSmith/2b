import { test, expect, describe, mock, afterEach } from "bun:test";
import { DynamicAgentPlugin } from "./DynamicAgentPlugin.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLLM(response = "answer"): LLMProvider {
  return {
    chat: mock(async () => ({ nonReasoningContent: response, reasoningContent: "" })),
    embed: mock(async () => new Array(64).fill(0)),
  } as unknown as LLMProvider;
}

function makeParent() {
  const emitted: { event: string; args: unknown[] }[] = [];
  return {
    parent: {
      emit: mock((event: string, ...args: unknown[]) => {
        emitted.push({ event, args });
        return true;
      }),
    } as unknown as BaseAgent,
    emitted,
  };
}

async function makePlugin(
  opts: ConstructorParameters<typeof DynamicAgentPlugin>[1] = {},
) {
  const llm = makeLLM();
  const plugin = new DynamicAgentPlugin(llm, opts);
  const { parent, emitted } = makeParent();
  plugin.onInit(parent);
  return { plugin, llm, parent, emitted };
}

// ---------------------------------------------------------------------------
// Fix 2 — cortex agent capability storage
// ---------------------------------------------------------------------------

describe("create_agent — capability storage", () => {
  test("stores empty capabilities for a cortex agent regardless of what was passed", async () => {
    const { plugin } = await makePlugin();

    await plugin.executeTool("create_agent", {
      name: "c1",
      system_prompt: "You are a researcher.",
      agent_type: "cortex",
      capabilities: ["web", "files"],
    });

    const result = (await plugin.executeTool("list_agents", {})) as { agents: { name: string; capabilities: string[] }[] };
    const entry = result.agents.find((a) => a.name === "c1");
    expect(entry?.capabilities).toEqual([]);

    // Cleanup — stop the live CortexSubAgent
    await plugin.executeTool("delete_agent", { name: "c1" });
  });

  test("stores capabilities for a headless agent", async () => {
    const { plugin } = await makePlugin();

    await plugin.executeTool("create_agent", {
      name: "h1",
      system_prompt: "You are helpful.",
      agent_type: "headless",
      capabilities: ["web", "wikipedia"],
    });

    const result = (await plugin.executeTool("list_agents", {})) as { agents: { name: string; capabilities: string[] }[] };
    const entry = result.agents.find((a) => a.name === "h1");
    expect(entry?.capabilities).toEqual(["web", "wikipedia"]);
  });

  test("stores empty capabilities for a cortex agent that passed none", async () => {
    const { plugin } = await makePlugin();

    await plugin.executeTool("create_agent", {
      name: "c2",
      system_prompt: "test",
      agent_type: "cortex",
      capabilities: [],
    });

    const result = (await plugin.executeTool("list_agents", {})) as { agents: { name: string; capabilities: string[] }[] };
    const entry = result.agents.find((a) => a.name === "c2");
    expect(entry?.capabilities).toEqual([]);

    await plugin.executeTool("delete_agent", { name: "c2" });
  });
});

// ---------------------------------------------------------------------------
// Fix 3 — delete_agent
// ---------------------------------------------------------------------------

describe("delete_agent", () => {
  test("removes a headless agent from the registry", async () => {
    const { plugin } = await makePlugin();

    await plugin.executeTool("create_agent", {
      name: "h2",
      system_prompt: "test",
      agent_type: "headless",
      capabilities: [],
    });

    const before = (await plugin.executeTool("list_agents", {})) as { agents: { name: string }[] };
    expect(before.agents.map((a) => a.name)).toContain("h2");

    const result = await plugin.executeTool("delete_agent", { name: "h2" });
    expect(result).toMatchObject({ deleted: "h2" });

    const after = (await plugin.executeTool("list_agents", {})) as { agents: { name: string }[] };
    expect(after.agents.map((a) => a.name)).not.toContain("h2");
  });

  test("removes a cortex agent and calls stop()", async () => {
    const { plugin } = await makePlugin();

    await plugin.executeTool("create_agent", {
      name: "c3",
      system_prompt: "test",
      agent_type: "cortex",
      capabilities: [],
    });

    const result = await plugin.executeTool("delete_agent", { name: "c3" });
    expect(result).toMatchObject({ deleted: "c3" });

    const list = (await plugin.executeTool("list_agents", {})) as { agents: { name: string }[] };
    expect(list.agents.map((a) => a.name)).not.toContain("c3");
  });

  test("throws a meaningful error when agent does not exist", async () => {
    const { plugin } = await makePlugin();

    await expect(
      plugin.executeTool("delete_agent", { name: "nobody" }),
    ).rejects.toThrow(/Agent "nobody" not found/);
  });

  test("error message lists available agents", async () => {
    const { plugin } = await makePlugin();

    await plugin.executeTool("create_agent", {
      name: "existing",
      system_prompt: "test",
      agent_type: "headless",
      capabilities: [],
    });

    await expect(
      plugin.executeTool("delete_agent", { name: "missing" }),
    ).rejects.toThrow(/existing/);
  });

  test("interrupts a headless agent that is in-flight before deleting", async () => {
    // LLM that hangs until its AbortSignal fires
    const llm: LLMProvider = {
      chat: mock(
        (_msgs, _sys, _hist, _tools, _onToken, signal) =>
          new Promise<{ nonReasoningContent: string; reasoningContent: string }>(
            (resolve, reject) => {
              signal?.addEventListener("abort", () =>
                reject(new Error("Aborted")),
              );
            },
          ),
      ),
      embed: mock(async () => []),
    } as unknown as LLMProvider;

    const plugin = new DynamicAgentPlugin(llm);
    const { parent } = makeParent();
    plugin.onInit(parent);

    await plugin.executeTool("create_agent", {
      name: "hanging",
      system_prompt: "test",
      agent_type: "headless",
      capabilities: [],
    });

    // Start a call that will never resolve on its own
    const callPromise = plugin.executeTool("call_agent", {
      name: "hanging",
      task: "do something",
    }) as Promise<unknown>;

    // Give the call time to enter the in-flight LLM request
    await Bun.sleep(20);

    // Delete while in-flight — should interrupt the call
    await plugin.executeTool("delete_agent", { name: "hanging" });

    // The call should reject because the LLM was aborted
    await expect(callPromise).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Fix 4 — subAgentTimeoutMs
// ---------------------------------------------------------------------------

describe("subAgentTimeoutMs", () => {
  let pluginToCleanup: DynamicAgentPlugin | null = null;

  afterEach(async () => {
    // Best-effort cleanup if a test left a cortex agent running
    if (pluginToCleanup) {
      try {
        await pluginToCleanup.executeTool("delete_agent", { name: "slow_cortex" });
      } catch {
        // already deleted or never created
      }
      pluginToCleanup = null;
    }
  });

  test("cortex agent rejects when ask() exceeds subAgentTimeoutMs", async () => {
    // LLM that never responds
    const llm: LLMProvider = {
      chat: mock(() => new Promise<never>(() => {})),
      embed: mock(async () => new Array(64).fill(0)),
    } as unknown as LLMProvider;

    const plugin = new DynamicAgentPlugin(llm, {
      subAgentTimeoutMs: 50,
    });
    const { parent } = makeParent();
    plugin.onInit(parent);
    pluginToCleanup = plugin;

    await plugin.executeTool("create_agent", {
      name: "slow_cortex",
      system_prompt: "test",
      agent_type: "cortex",
      capabilities: [],
    });

    await expect(
      plugin.executeTool("call_agent", {
        name: "slow_cortex",
        task: "do something long",
      }),
    ).rejects.toThrow(/timed out/i);
  });
});

// ---------------------------------------------------------------------------
// Fix 5 — cortex presets via agent_type field on AgentPreset
// ---------------------------------------------------------------------------

describe("presets — agent_type", () => {
  test("preset without agent_type creates a headless agent", async () => {
    const { plugin } = await makePlugin({
      presets: {
        my_headless: {
          system_prompt: "You are a helper.",
          capabilities: [],
        },
      },
    });

    const result = (await plugin.executeTool("list_agents", {})) as { agents: { name: string; type: string }[] };
    const entry = result.agents.find((a) => a.name === "my_headless");
    expect(entry?.type).toBe("headless");
  });

  test("preset with agent_type: cortex creates a cortex agent", async () => {
    const { plugin } = await makePlugin({
      presets: {
        my_cortex: {
          system_prompt: "You are a persistent researcher.",
          capabilities: [],
          agent_type: "cortex",
        },
      },
    });

    const result = (await plugin.executeTool("list_agents", {})) as { agents: { name: string; type: string }[] };
    const entry = result.agents.find((a) => a.name === "my_cortex");
    expect(entry?.type).toBe("cortex");

    // Cleanup
    await plugin.executeTool("delete_agent", { name: "my_cortex" });
  });

  test("cortex preset capabilities are stored as []", async () => {
    const { plugin } = await makePlugin({
      presets: {
        cortex_with_caps: {
          system_prompt: "test",
          capabilities: ["web"],
          agent_type: "cortex",
        },
      },
    });

    const result = (await plugin.executeTool("list_agents", {})) as { agents: { name: string; capabilities: string[] }[] };
    const entry = result.agents.find((a) => a.name === "cortex_with_caps");
    expect(entry?.capabilities).toEqual([]);

    await plugin.executeTool("delete_agent", { name: "cortex_with_caps" });
  });
});

// ---------------------------------------------------------------------------
// Foundational — list_agents and create_agent validation
// ---------------------------------------------------------------------------

describe("list_agents", () => {
  test("returns empty list when no agents have been created", async () => {
    const { plugin } = await makePlugin();
    const result = (await plugin.executeTool("list_agents", {})) as { agents: unknown[] };
    expect(result.agents).toEqual([]);
  });

  test("includes type and createdAt for each agent", async () => {
    const { plugin } = await makePlugin();

    await plugin.executeTool("create_agent", {
      name: "meta_test",
      system_prompt: "test",
      agent_type: "headless",
      capabilities: [],
    });

    const result = (await plugin.executeTool("list_agents", {})) as {
      agents: { name: string; type: string; createdAt: string }[];
    };
    const entry = result.agents.find((a) => a.name === "meta_test");
    expect(entry?.type).toBe("headless");
    expect(typeof entry?.createdAt).toBe("string");
  });
});

describe("create_agent validation", () => {
  test("rejects invalid agent names", async () => {
    const { plugin } = await makePlugin();

    await expect(
      plugin.executeTool("create_agent", {
        name: "bad name!",
        system_prompt: "test",
        agent_type: "headless",
        capabilities: [],
      }),
    ).rejects.toThrow(/Invalid agent name/);
  });

  test("rejects duplicate agent names", async () => {
    const { plugin } = await makePlugin();

    await plugin.executeTool("create_agent", {
      name: "dup",
      system_prompt: "test",
      agent_type: "headless",
      capabilities: [],
    });

    await expect(
      plugin.executeTool("create_agent", {
        name: "dup",
        system_prompt: "other",
        agent_type: "headless",
        capabilities: [],
      }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("call_agent", () => {
  test("returns the agent response for a headless agent", async () => {
    const llm = makeLLM("the answer");
    const plugin = new DynamicAgentPlugin(llm);
    const { parent } = makeParent();
    plugin.onInit(parent);

    await plugin.executeTool("create_agent", {
      name: "answerer",
      system_prompt: "Answer questions.",
      agent_type: "headless",
      capabilities: [],
    });

    const result = await plugin.executeTool("call_agent", {
      name: "answerer",
      task: "What is 2+2?",
    });
    expect(result).toBe("the answer");
  });

  test("throws when calling an unknown agent", async () => {
    const { plugin } = await makePlugin();

    await expect(
      plugin.executeTool("call_agent", { name: "ghost", task: "hello" }),
    ).rejects.toThrow(/Agent "ghost" not found/);
  });
});
