import { test, expect, describe, mock } from "bun:test";
import { ThoughtPlugin } from "./ThoughtPlugin";
import { CortexMemoryPlugin } from "./CortexMemoryPlugin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLlm(embeddingFn?: (t: string) => number[]) {
  const fn = embeddingFn ?? (() => [1, 0, 0, 0]);
  return { getEmbedding: mock(async (t: string) => fn(t)) };
}

function makeMemoryPlugin() {
  return new CortexMemoryPlugin(makeLlm() as any, "test", ":memory:");
}

/** Minimal agent stub that captures event listeners. */
function makeAgent() {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    on: mock((event: string, cb: (...args: any[]) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    }),
    emit: async (event: string, ...args: any[]) => {
      for (const cb of listeners[event] ?? []) {
        await cb(...args);
      }
    },
    listenerCount: (event: string) => (listeners[event] ?? []).length,
  };
}

function makeSynthesisProvider(response: string) {
  return {
    chat: mock(async () => ({
      response,
      nonReasoningContent: response,
      reasoningContent: "",
    })),
  };
}

// ---------------------------------------------------------------------------
// Thought storage
// ---------------------------------------------------------------------------

describe("thought storage (via agent 'thought' event)", () => {
  test("thought content is stored as raw text without prefix", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, null);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    await agent.emit("thought", "I wonder about the universe");

    const memories = mem.queryMemoriesRaw({ types: ["thought"] });
    expect(memories).toHaveLength(1);
    expect(memories[0].text).toBe("I wonder about the universe");
  });

  test("empty or whitespace-only thought is not stored", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, null);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    await agent.emit("thought", "   ");

    const memories = mem.queryMemoriesRaw({ types: ["thought"] });
    expect(memories).toHaveLength(0);
  });

  test("thought type is 'thought'", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, null);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    await agent.emit("thought", "some reasoning");

    const memories = mem.queryMemoriesRaw({ types: ["thought"] });
    expect(memories[0].type).toBe("thought");
  });
});

// ---------------------------------------------------------------------------
// Synthesis — SKIP response
// ---------------------------------------------------------------------------

describe("synthesis", () => {
  test("SKIP response saves no behavior memory", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, makeSynthesisProvider("SKIP") as any);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    await agent.emit("thought", "Step 1: add numbers together");
    // Give synthesis microtask a chance to complete
    await new Promise((r) => setTimeout(r, 10));

    const behaviors = mem.queryMemoriesRaw({ types: ["behavior"] });
    expect(behaviors).toHaveLength(0);
  });

  test("insight longer than MAX_INSIGHT_LENGTH (200 chars) is not saved", async () => {
    const longInsight = "I " + "x".repeat(200); // 202 chars total
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, makeSynthesisProvider(longInsight) as any);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    await agent.emit("thought", "some qualifying thought");
    await new Promise((r) => setTimeout(r, 10));

    const behaviors = mem.queryMemoriesRaw({ types: ["behavior"] });
    expect(behaviors).toHaveLength(0);
  });

  test("insight not starting with 'I ' is rejected", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, makeSynthesisProvider("Always be concise") as any);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    await agent.emit("thought", "some qualifying thought");
    await new Promise((r) => setTimeout(r, 10));

    const behaviors = mem.queryMemoriesRaw({ types: ["behavior"] });
    expect(behaviors).toHaveLength(0);
  });

  test("valid insight starting with 'I ' is saved as behavior", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, makeSynthesisProvider("I prefer concise answers") as any);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    await agent.emit("thought", "I like short answers");
    await new Promise((r) => setTimeout(r, 10));

    const behaviors = mem.queryMemoriesRaw({ types: ["behavior"] });
    expect(behaviors).toHaveLength(1);
    expect(behaviors[0].text).toBe("I prefer concise answers");
  });

  test("deduplication: identical insight is not saved twice", async () => {
    const insight = "I prefer concise answers";
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, makeSynthesisProvider(insight) as any);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    // First thought → saves behavior
    await agent.emit("thought", "first thought");
    await new Promise((r) => setTimeout(r, 10));

    // Second thought → same insight, should be skipped
    await agent.emit("thought", "second thought");
    await new Promise((r) => setTimeout(r, 10));

    const behaviors = mem.queryMemoriesRaw({ types: ["behavior"] });
    expect(behaviors).toHaveLength(1);
  });

  test("synthesis errors are caught and do not propagate", async () => {
    const brokenProvider = {
      chat: mock(async () => { throw new Error("LLM down"); }),
    };
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, brokenProvider as any);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    // Should not throw
    await expect(agent.emit("thought", "some thought")).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 10));
  });

  test("no synthesis when synthesisProvider is null", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, null);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    await agent.emit("thought", "I prefer short answers");
    await new Promise((r) => setTimeout(r, 10));

    const behaviors = mem.queryMemoriesRaw({ types: ["behavior"] });
    expect(behaviors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// onInit guard
// ---------------------------------------------------------------------------

describe("onInit guard", () => {
  test("calling onInit twice registers the listener only once", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, null);
    const agent = makeAgent();

    plugin.onInit(agent as any);
    plugin.onInit(agent as any);

    expect(agent.listenerCount("thought")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// get_recent_thoughts tool
// ---------------------------------------------------------------------------

describe("get_recent_thoughts tool", () => {
  test("returns 'No recent thoughts found.' when empty", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, null);
    const result = await plugin.executeTool("get_recent_thoughts", {});
    expect(result).toBe("No recent thoughts found.");
  });

  test("returns stored thought texts with ISO timestamp prefix joined by newline", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, null);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    await agent.emit("thought", "first thought");
    await agent.emit("thought", "second thought");

    const result = (await plugin.executeTool("get_recent_thoughts", { limit: 5 })) as string;
    // Each line has format: [ISO timestamp] thought text
    expect(result).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    expect(result).toContain("first thought");
    expect(result).toContain("second thought");
  });

  test("respects limit parameter", async () => {
    const mem = makeMemoryPlugin();
    const plugin = new ThoughtPlugin(mem, null);
    const agent = makeAgent();
    plugin.onInit(agent as any);

    for (let i = 0; i < 5; i++) {
      await agent.emit("thought", `thought ${i}`);
    }

    const result = (await plugin.executeTool("get_recent_thoughts", { limit: 2 })) as string;
    const lines = result.trim().split("\n");
    expect(lines).toHaveLength(2);
  });
});
