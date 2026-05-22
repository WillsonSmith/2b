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

  test("after summarization, running summary is exposed as a system message and user messages are unmodified", async () => {
    const llm = makeLLM("Summary text here.");
    const plugin = new MemoryPlugin(llm, { maxMessages: 3, minMessages: 2 });

    await plugin.onMessage("user", "one", "test");
    await plugin.onMessage("user", "two", "test");
    await plugin.onMessage("user", "three", "test");
    await plugin.onMessage("user", "four", "test");

    const msgs = await plugin.getMessages();

    // Summary lives on its own as a system entry, separate from any user message.
    const summaryMsg = msgs.find(
      (m) => m.role === "system" && m.content.includes("Running conversation summary"),
    );
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg?.content).toContain("Summary text here.");

    // No user message should carry summary-attribution noise.
    for (const u of msgs.filter((m) => m.role === "user")) {
      expect(u.content).not.toContain("SYSTEM NOTE");
      expect(u.content).not.toContain("Running conversation summary");
    }
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

  test("messages added while summarization is in flight are preserved", async () => {
    // LLM mock that pauses until we explicitly resolve, so we can interleave
    // a fresh onMessage call between the await and the splice.
    let releaseChat: (value: { response: string; nonReasoningContent: string; reasoningContent: string; reasoningText: string }) => void = () => {};
    const chatPromise = new Promise<{ response: string; nonReasoningContent: string; reasoningContent: string; reasoningText: string }>((resolve) => {
      releaseChat = resolve;
    });
    const llm = {
      chat: mock(async () => chatPromise),
      embed: mock(async () => []),
    } as unknown as LLMProvider;

    const plugin = new MemoryPlugin(llm, { maxMessages: 3, minMessages: 2 });

    await plugin.onMessage("user", "one", "test");
    await plugin.onMessage("user", "two", "test");
    await plugin.onMessage("user", "three", "test");
    // 4th message triggers summarization; chat is now suspended on chatPromise
    await plugin.onMessage("user", "four", "test");

    // While summarization is suspended on the LLM call, push a fresh message.
    await plugin.onMessage("user", "five-during-await", "test");

    // Now release the LLM call.
    releaseChat({
      response: "Mid-flight summary.",
      nonReasoningContent: "Mid-flight summary.",
      reasoningContent: "",
      reasoningText: "",
    });
    // Allow the summarization continuation to run.
    await new Promise((r) => setTimeout(r, 0));

    const msgs = await plugin.getMessages();
    const contents = msgs.filter((m) => m.role === "user").map((m) => m.content);
    // The race fix requires the message pushed during the await to still be present.
    expect(contents).toContain("five-during-await");
  });

  test("empty summary response leaves history unchanged and produces no noise", async () => {
    const llm = makeLLM("");
    const plugin = new MemoryPlugin(llm, { maxMessages: 3, minMessages: 2 });

    await plugin.onMessage("user", "a", "test");
    await plugin.onMessage("user", "b", "test");
    await plugin.onMessage("user", "c", "test");
    await plugin.onMessage("user", "d", "test");

    const msgs = await plugin.getMessages();
    // Empty summary must not be injected as a system entry.
    const summaryMsg = msgs.find(
      (m) => m.role === "system" && m.content.includes("Running conversation summary"),
    );
    expect(summaryMsg).toBeUndefined();
    // No user message should carry a degenerate "SYSTEM NOTE: " prefix.
    for (const u of msgs.filter((m) => m.role === "user")) {
      expect(u.content).not.toContain("SYSTEM NOTE");
    }
    // History is intact for a retry on the next trigger.
    const userContents = msgs.filter((m) => m.role === "user").map((m) => m.content);
    expect(userContents).toEqual(["a", "b", "c", "d"]);
  });

  test("rolling summary carries the prior summary into the next cycle", async () => {
    const responses = ["First summary.", "Second summary that integrates earlier."];
    let callIdx = 0;
    const llm = {
      chat: mock(async () => {
        const text = responses[callIdx++] ?? "fallback";
        return {
          response: text,
          nonReasoningContent: text,
          reasoningContent: "",
          reasoningText: "",
        };
      }),
      embed: mock(async () => []),
    } as unknown as LLMProvider;

    const plugin = new MemoryPlugin(llm, { maxMessages: 4, minMessages: 2 });

    // Cycle 1: push 5 messages (4 → trigger summarization at i=4)
    for (let i = 0; i < 5; i++) {
      await plugin.onMessage("user", `m${i}`, "test");
    }
    // Cycle 2: push enough more to trigger again
    for (let i = 5; i < 10; i++) {
      await plugin.onMessage("user", `m${i}`, "test");
    }

    const msgs = await plugin.getMessages();
    const summaryMsg = msgs.find(
      (m) => m.role === "system" && m.content.includes("Running conversation summary"),
    );
    expect(summaryMsg).toBeDefined();
    // The final summary must be the second cycle's output, length-capped.
    expect(summaryMsg?.content).toContain("Second summary that integrates earlier.");

    // The second call to the summarizer must have received the first summary
    // in its prompt — that's the rolling part of "rolling summary".
    const chatCalls = (llm.chat as ReturnType<typeof mock>).mock.calls;
    expect(chatCalls.length).toBeGreaterThanOrEqual(2);
    const secondCallMessages = chatCalls[1]?.[0] as Array<{ role: string; content: string }>;
    const userPromptInSecondCall = secondCallMessages.find((m) => m.role === "user")?.content ?? "";
    expect(userPromptInSecondCall).toContain("First summary.");
  });
});

describe("MemoryPlugin - limit accounting with summary", () => {
  test("limit=1 with system + summary returns prefix only, never the full history", async () => {
    const llm = makeLLM("A running summary.");
    const plugin = new MemoryPlugin(llm, { maxMessages: 3, minMessages: 2 });

    await plugin.onMessage("system", "MAIN_SYS", "test");
    await plugin.onMessage("user", "one", "test");
    await plugin.onMessage("user", "two", "test");
    await plugin.onMessage("user", "three", "test");
    await plugin.onMessage("user", "four", "test");

    const msgs = await plugin.getMessages(1);

    // The regression being guarded: limit=1 must NOT fall through to "return
    // every conversation message" the way the original implementation did
    // when conversationLimit went to zero. The prefix slots (main system +
    // summary) are essential and stay; conversation must be empty.
    expect(msgs.filter((m) => m.role === "user")).toHaveLength(0);
    expect(msgs.filter((m) => m.role === "assistant")).toHaveLength(0);
    // Both prefix entries are kept since both convey essential context.
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.content).toBe("MAIN_SYS");
  });

  test("limit=1 with only a main system message (no summary) returns just the system message", async () => {
    // This is the original-review bug case: limit=1, hasSystem=true used to
    // return the full history. It should now return only the system entry.
    const plugin = new MemoryPlugin(makeLLM(), { maxMessages: 100, minMessages: 5 });
    await plugin.onMessage("system", "SYS", "test");
    for (let i = 0; i < 5; i++) {
      await plugin.onMessage("user", `m${i}`, "test");
    }
    const msgs = await plugin.getMessages(1);
    expect(msgs).toEqual([{ role: "system", content: "SYS" }]);
  });

  test("clear() resets running summary as well as messages", async () => {
    const llm = makeLLM("Will be cleared.");
    const plugin = new MemoryPlugin(llm, { maxMessages: 3, minMessages: 2 });

    await plugin.onMessage("user", "a", "test");
    await plugin.onMessage("user", "b", "test");
    await plugin.onMessage("user", "c", "test");
    await plugin.onMessage("user", "d", "test");

    plugin.clear();
    const msgs = await plugin.getMessages();
    expect(msgs).toEqual([]);
  });
});
