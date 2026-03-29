import { test, expect, describe, mock } from "bun:test";
import { MemoryPlugin } from "./MemoryPlugin";
import type { LLMProvider } from "../providers/llm/LLMProvider";

function makeLLM(summaryResponse = "A summary."): LLMProvider {
  return {
    chat: mock(async () => ({
      response: summaryResponse,
      nonReasoningContent: summaryResponse,
      reasoningContent: "",
      reasoningText: "",
    })),
    embed: mock(async () => []),
  } as unknown as LLMProvider;
}

async function addMessages(plugin: MemoryPlugin, messages: Array<{ role: "user" | "assistant" | "system"; content: string }>) {
  for (const m of messages) {
    await plugin.onMessage(m.role, m.content, "test");
  }
}

describe("MemoryPlugin - message storage", () => {
  test("messages are stored and returned in insertion order", async () => {
    const plugin = new MemoryPlugin(makeLLM());
    await plugin.onMessage("user", "hello", "test");
    await plugin.onMessage("assistant", "world", "test");

    const msgs = await plugin.getMessages();
    expect(msgs).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]);
  });

  test("system message is isolated and prepended separately", async () => {
    const plugin = new MemoryPlugin(makeLLM());
    await plugin.onMessage("system", "SYS", "test");
    await plugin.onMessage("user", "hello", "test");
    await plugin.onMessage("assistant", "hi", "test");

    const msgs = await plugin.getMessages();
    expect(msgs[0]).toEqual({ role: "system", content: "SYS" });
    expect(msgs[1]).toEqual({ role: "user", content: "hello" });
    expect(msgs[2]).toEqual({ role: "assistant", content: "hi" });
  });

  test("system message does not count toward conversation history", async () => {
    const plugin = new MemoryPlugin(makeLLM());
    await plugin.onMessage("system", "SYS", "test");
    await plugin.onMessage("user", "a", "test");
    await plugin.onMessage("assistant", "b", "test");

    // History should have system + 2 messages, not just 2
    const msgs = await plugin.getMessages();
    expect(msgs).toHaveLength(3);
  });

  test("empty history returns empty array", async () => {
    const plugin = new MemoryPlugin(makeLLM());
    const msgs = await plugin.getMessages();
    expect(msgs).toEqual([]);
  });

  test("leading assistant messages are removed from returned history", async () => {
    const plugin = new MemoryPlugin(makeLLM());
    await plugin.onMessage("assistant", "I start", "test");
    await plugin.onMessage("user", "user msg", "test");

    const msgs = await plugin.getMessages();
    // First message must be user
    expect(msgs[0]?.role).toBe("user");
    expect(msgs).toHaveLength(1);
  });

  test("only-assistant messages results in empty history", async () => {
    const plugin = new MemoryPlugin(makeLLM());
    await plugin.onMessage("assistant", "only me", "test");

    const msgs = await plugin.getMessages();
    expect(msgs).toEqual([]);
  });

  test("single user message is returned correctly", async () => {
    const plugin = new MemoryPlugin(makeLLM());
    await plugin.onMessage("user", "single", "test");

    const msgs = await plugin.getMessages();
    expect(msgs).toEqual([{ role: "user", content: "single" }]);
  });
});

describe("MemoryPlugin - historyLimit", () => {
  test("getMessages(limit) respects the limit", async () => {
    const plugin = new MemoryPlugin(makeLLM());
    for (let i = 0; i < 6; i++) {
      await plugin.onMessage("user", `msg ${i}`, "test");
    }
    const msgs = await plugin.getMessages(3);
    // limit=3 means up to 3 messages returned (no system prompt here)
    expect(msgs.length).toBeLessThanOrEqual(3);
    // Most recent messages should be kept
    expect(msgs[msgs.length - 1]?.content).toBe("msg 5");
  });

  test("system prompt takes one slot from the limit", async () => {
    const plugin = new MemoryPlugin(makeLLM());
    await plugin.onMessage("system", "SYS", "test");
    for (let i = 0; i < 6; i++) {
      await plugin.onMessage("user", `msg ${i}`, "test");
    }
    const msgs = await plugin.getMessages(3);
    // limit=3: 1 used by system, so 2 conversation messages + system = 3 total
    expect(msgs.length).toBeLessThanOrEqual(3);
    expect(msgs[0]?.role).toBe("system");
  });
});

describe("MemoryPlugin - auto-summarization", () => {
  test("summarization triggers when messages exceed MAX_MESSAGES", async () => {
    const llm = makeLLM("A helpful summary.");
    const plugin = new MemoryPlugin(llm, { maxMessages: 5, minMessages: 2 });

    // Add 5 user messages to stay within limit
    for (let i = 0; i < 5; i++) {
      await plugin.onMessage("user", `msg ${i}`, "test");
    }
    // LLM chat not called yet
    expect((llm.chat as ReturnType<typeof mock>).mock.calls).toHaveLength(0);

    // 6th message exceeds MAX_MESSAGES=5, triggers summarization
    await plugin.onMessage("user", "msg 5", "test");
    expect((llm.chat as ReturnType<typeof mock>).mock.calls).toHaveLength(1);
  });

  test("after summarization, summary is prepended to first retained message", async () => {
    const llm = makeLLM("Summary text here.");
    const plugin = new MemoryPlugin(llm, { maxMessages: 3, minMessages: 2 });

    await plugin.onMessage("user", "one", "test");
    await plugin.onMessage("user", "two", "test");
    await plugin.onMessage("user", "three", "test");
    // 4th message triggers summarization
    await plugin.onMessage("user", "four", "test");

    const msgs = await plugin.getMessages();
    // After summarization, first message should contain the summary attribution
    const firstMsg = msgs.find((m) => m.role === "user");
    expect(firstMsg?.content).toContain("Summary text here.");
    expect(firstMsg?.content).toContain("SYSTEM NOTE");
  });

  test("summarization failure falls back gracefully without crashing", async () => {
    const llm = {
      chat: mock(async () => { throw new Error("LLM unavailable"); }),
      embed: mock(async () => []),
    } as unknown as LLMProvider;

    const plugin = new MemoryPlugin(llm, { maxMessages: 3, minMessages: 2 });

    await plugin.onMessage("user", "a", "test");
    await plugin.onMessage("user", "b", "test");
    await plugin.onMessage("user", "c", "test");

    // Should not throw
    await expect(plugin.onMessage("user", "d", "test")).resolves.toBeUndefined();

    // Recent messages are retained even without summary
    const msgs = await plugin.getMessages();
    expect(msgs.length).toBeGreaterThan(0);
  });

  test("getMessages after summarization respects historyLimit", async () => {
    const llm = makeLLM("Short summary.");
    const plugin = new MemoryPlugin(llm, { maxMessages: 5, minMessages: 3 });

    for (let i = 0; i < 6; i++) {
      await plugin.onMessage("user", `msg ${i}`, "test");
    }

    const msgs = await plugin.getMessages(3);
    expect(msgs.length).toBeLessThanOrEqual(3);
  });
});
