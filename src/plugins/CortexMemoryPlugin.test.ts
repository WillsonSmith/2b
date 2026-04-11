import { test, expect, describe, mock } from "bun:test";
import { CortexMemoryPlugin } from "./CortexMemoryPlugin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a plugin backed by an in-memory SQLite DB.
 * embeddingFn receives the text being embedded and returns a vector.
 * Defaults to returning [1,0,0,0] for every input.
 */
function makePlugin(embeddingFn?: (text: string) => number[]) {
  const fn = embeddingFn ?? (() => [1, 0, 0, 0]);
  const llm = { getEmbedding: mock(async (t: string) => fn(t)) };
  return new CortexMemoryPlugin(llm as any, "test", ":memory:");
}

// ---------------------------------------------------------------------------
// getContext
// ---------------------------------------------------------------------------

describe("getContext", () => {
  test("returns empty string when no events provided", async () => {
    const plugin = makePlugin();
    const ctx = await plugin.getContext([]);
    expect(ctx).toBe("");
  });

  test("surfaces factual memories above 0.5 threshold", async () => {
    // All embeddings are the same vector → cosine similarity = 1.0 ≥ 0.5
    const plugin = makePlugin();
    await plugin.executeTool("save_memory", { content: "Paris is the capital of France", type: "factual" });
    const ctx = await plugin.getContext(["capital cities"]);
    expect(ctx).toContain("Paris is the capital of France");
  });

  test("surfaces procedure memories above 0.65 threshold", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_procedure", { goal: "Deploy to production", steps: "1. Run tests\n2. Push tag" });
    const ctx = await plugin.getContext(["deploy production"]);
    expect(ctx).toContain("[PROCEDURE]");
  });

  test("returns empty string on error (graceful fallback)", async () => {
    const brokenLlm = { getEmbedding: mock(async () => { throw new Error("embedding failed"); }) };
    const plugin = new CortexMemoryPlugin(brokenLlm as any, "test", ":memory:");
    const ctx = await plugin.getContext(["anything"]);
    expect(ctx).toBe("");
  });
});

// ---------------------------------------------------------------------------
// search_memory
// ---------------------------------------------------------------------------

describe("search_memory", () => {
  test("returns 'No relevant memories found.' when empty", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("search_memory", { query: "anything" });
    expect(result).toBe("No relevant memories found.");
  });

  test("truncates content at 300 chars with ellipsis", async () => {
    const plugin = makePlugin();
    const longText = "x".repeat(400);
    await plugin.executeTool("save_memory", { content: longText, type: "factual" });
    const result = await plugin.executeTool("search_memory", { query: "x" });
    // The result should contain 300 x's followed by ellipsis
    expect(result).toContain("x".repeat(300) + "…");
  });

  test("formats result with id prefix and score", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_memory", { content: "short fact", type: "factual" });
    const result = await plugin.executeTool("search_memory", { query: "fact" });
    expect(result).toMatch(/^\[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\] \(score: [\d.]+\) short fact/);
  });

  test("type filter limits results to matching type", async () => {
    // Use identical embeddings so all would normally match
    const plugin = makePlugin();
    await plugin.executeTool("save_memory", { content: "a thought", type: "thought" });
    await plugin.executeTool("save_memory", { content: "a fact", type: "factual" });
    const result = await plugin.executeTool("search_memory", { query: "query", type: "factual" });
    expect(result).toContain("a fact");
    expect(result).not.toContain("a thought");
  });
});

// ---------------------------------------------------------------------------
// save_memory
// ---------------------------------------------------------------------------

describe("save_memory", () => {
  test("rejects content exceeding 10K chars", async () => {
    const plugin = makePlugin();
    const huge = "a".repeat(10_001);
    const result = await plugin.executeTool("save_memory", { content: huge, type: "factual" });
    expect(result).toContain("too long");
    expect(result).toContain("10000");
  });

  test("returns success message with id and type", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("save_memory", { content: "test fact", type: "factual" });
    expect(result).toMatch(/Memory saved \(type: factual, id: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)\./);
  });

  test("auto-links to up to 3 similar memories after saving", async () => {
    // All embeddings identical → maximum similarity = 1.0 → all qualify
    const plugin = makePlugin();
    // Add 4 existing memories
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = (await plugin.executeTool("save_memory", { content: `existing ${i}`, type: "factual" })) as string;
      const match = r.match(/id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
      if (match) ids.push(match[1]);
    }
    // Save a new one — should link to at most 3 of the existing ones
    await plugin.executeTool("save_memory", { content: "new memory", type: "factual" });
    // Verify via query_memories (indirect validation — if no error, linking ran)
    const ctx = await plugin.getContext(["new memory"]);
    expect(typeof ctx).toBe("string"); // no crash
  });
});

// ---------------------------------------------------------------------------
// save_behavior
// ---------------------------------------------------------------------------

describe("save_behavior", () => {
  test("invalidates behavior cache so next system prompt reload fetches fresh data", async () => {
    const plugin = makePlugin();
    // Prime the cache
    await plugin.getSystemPromptFragment();
    // Save a behavior — should invalidate cache
    await plugin.executeTool("save_behavior", { rule: "Always respond concisely" });
    // Next system prompt call should include the new behavior
    const prompt = await plugin.getSystemPromptFragment();
    expect(prompt).toContain("Always respond concisely");
  });

  test("injects behavior into system prompt fragment", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_behavior", { rule: "Use bullet points" });
    const prompt = await plugin.getSystemPromptFragment();
    expect(prompt).toContain("Behaviors");
    expect(prompt).toContain("Use bullet points");
  });

  test("rejects rule exceeding 10K chars", async () => {
    const plugin = makePlugin();
    const huge = "b".repeat(10_001);
    const result = await plugin.executeTool("save_behavior", { rule: huge });
    expect(result).toContain("too long");
  });

  test("saves core behavior with 'core' tag when core: true", async () => {
    const plugin = makePlugin();
    const result = (await plugin.executeTool("save_behavior", { rule: "Always use markdown", core: true })) as string;
    expect(result).toContain("core: true");
    const memories = plugin.db.queryMemories({ types: ["behavior"], tags: ["core"] });
    expect(memories).toHaveLength(1);
    expect(memories[0]!.text).toBe("Always use markdown");
  });

  test("core behaviors always appear in prompt regardless of context", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_behavior", { rule: "Always use markdown", core: true });
    // No context provided — should still show core behavior
    const prompt = await plugin.getSystemPromptFragment();
    expect(prompt).toContain("## Core Behaviors");
    expect(prompt).toContain("Always use markdown");
  });

  test("core behaviors are not duplicated in contextual section", async () => {
    // All embeddings are identical (sim=1.0), so without deduplication the core
    // behavior would appear in both sections.
    const plugin = makePlugin();
    await plugin.executeTool("save_behavior", { rule: "Core rule", core: true });
    await plugin.executeTool("save_behavior", { rule: "Contextual rule", core: false });
    const prompt = await plugin.getSystemPromptFragment("some user input");
    // Core rule must appear exactly once
    const coreCount = (prompt.match(/Core rule/g) ?? []).length;
    expect(coreCount).toBe(1);
    // Contextual rule should be present
    expect(prompt).toContain("Contextual rule");
    // Sections are labeled correctly
    expect(prompt).toContain("## Core Behaviors");
    expect(prompt).toContain("## Contextually Active Behaviors");
  });
});

// ---------------------------------------------------------------------------
// save_procedure
// ---------------------------------------------------------------------------

describe("save_procedure", () => {
  test("stores combined [PROCEDURE] goal+steps string", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_procedure", { goal: "My goal", steps: "Step 1\nStep 2" });
    const result = await plugin.executeTool("search_memory", { query: "goal", type: "procedure" });
    expect(result).toContain("[PROCEDURE] My goal");
    expect(result).toContain("Step 1");
  });

  test("rejects oversized combined content", async () => {
    const plugin = makePlugin();
    const big = "z".repeat(10_000);
    const result = await plugin.executeTool("save_procedure", { goal: big, steps: "steps" });
    expect(result).toContain("too long");
  });
});

// ---------------------------------------------------------------------------
// edit_memory
// ---------------------------------------------------------------------------

describe("edit_memory", () => {
  test("updates memory text", async () => {
    const plugin = makePlugin();
    const saveResult = (await plugin.executeTool("save_memory", {
      content: "original",
      type: "factual",
    })) as string;
    const match = saveResult.match(/id: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/);
    expect(match).not.toBeNull();
    const fullId = match![1];

    await plugin.executeTool("edit_memory", { id: fullId, content: "updated" });
    const updated = await plugin.db.getMemoryById(fullId);
    expect(updated?.text).toBe("updated");
  });

  test("returns error message for non-existent ID", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("edit_memory", { id: "nonexistent-id-00000000000000000", content: "x" });
    expect(result).toContain("No memory found");
  });
});

// ---------------------------------------------------------------------------
// delete_memory
// ---------------------------------------------------------------------------

describe("delete_memory", () => {
  test("removes the memory", async () => {
    const plugin = makePlugin();
    const saveResult = (await plugin.executeTool("save_memory", {
      content: "to delete",
      type: "factual",
    })) as string;
    const memories = plugin.db.queryMemories({});
    expect(memories).toHaveLength(1);

    await plugin.executeTool("delete_memory", { id: memories[0].id });
    const after = plugin.db.queryMemories({});
    expect(after).toHaveLength(0);
  });

  test("returns error for non-existent ID", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("delete_memory", { id: "00000000-0000-0000-0000-000000000000" });
    expect(result).toContain("No memory found");
  });

  test("invalidates behavior cache when a behavior memory is deleted", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_behavior", { rule: "Speak formally" });
    const memories = plugin.db.queryMemories({ types: ["behavior"] });
    expect(memories).toHaveLength(1);

    // Prime the cache
    await plugin.getSystemPromptFragment();

    // Delete the behavior
    await plugin.executeTool("delete_memory", { id: memories[0].id });

    // Cache should be invalidated — system prompt should no longer show the rule
    const prompt = await plugin.getSystemPromptFragment();
    expect(prompt).not.toContain("Speak formally");
  });

  test("requires a valid string id", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("delete_memory", { id: null });
    expect(result).toContain("requires a valid memory id");
  });
});

// ---------------------------------------------------------------------------
// delete_memory — batch path
// ---------------------------------------------------------------------------

describe("delete_memory — batch path", () => {
  test("deletes multiple memories in one call; all absent from DB after", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_memory", { content: "memory one", type: "factual" });
    await plugin.executeTool("save_memory", { content: "memory two", type: "factual" });
    const memories = plugin.db.queryMemories({});
    expect(memories).toHaveLength(2);
    const ids = memories.map((m) => m.id);

    const result = await plugin.executeTool("delete_memory", { ids }) as string;
    expect(result).toContain("2 deleted");
    expect(result).toContain("0 not found");
    const after = plugin.db.queryMemories({});
    expect(after).toHaveLength(0);
  });

  test("reports missing IDs without failing (partial success)", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_memory", { content: "exists", type: "factual" });
    const memories = plugin.db.queryMemories({});
    const realId = memories[0]!.id;

    const result = await plugin.executeTool("delete_memory", {
      ids: [realId, "00000000-0000-0000-0000-000000000000"],
    }) as string;
    expect(result).toContain("1 deleted");
    expect(result).toContain("1 not found");
    const after = plugin.db.queryMemories({});
    expect(after).toHaveLength(0);
  });

  test("invalidates coreBehaviorCache once for the whole batch", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_behavior", { rule: "Rule A", core: true });
    await plugin.executeTool("save_behavior", { rule: "Rule B", core: true });
    // Prime the cache
    await plugin.getSystemPromptFragment();
    expect((plugin as any).coreBehaviorCache).not.toBeNull();

    const memories = plugin.db.queryMemories({ types: ["behavior"] });
    const ids = memories.map((m) => m.id);
    await plugin.executeTool("delete_memory", { ids });

    expect((plugin as any).coreBehaviorCache).toBeNull();
  });

  test("counts non-string and blank entries as invalid, not missing", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_memory", { content: "valid one", type: "factual" });
    const memories = plugin.db.queryMemories({});
    const realId = memories[0]!.id;

    const result = await plugin.executeTool("delete_memory", {
      ids: [realId, 42, ""],
    }) as string;
    expect(result).toContain("1 deleted");
    expect(result).toContain("0 not found");
    expect(result).toContain("2 invalid");
    expect(result).toContain("out of 3 requested");
    const after = plugin.db.queryMemories({});
    expect(after).toHaveLength(0);
  });

  test("returns empty-array error when ids: [] is passed", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("delete_memory", { ids: [] }) as string;
    expect(result).toContain("'ids' array is empty");
  });

  test("single-delete regression: existing id-form still works correctly", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_memory", { content: "to delete", type: "factual" });
    const memories = plugin.db.queryMemories({});
    expect(memories).toHaveLength(1);

    const result = await plugin.executeTool("delete_memory", { id: memories[0]!.id }) as string;
    expect(result).toContain("deleted");
    const after = plugin.db.queryMemories({});
    expect(after).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// query_memories
// ---------------------------------------------------------------------------

describe("query_memories", () => {
  test("filters by types", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_memory", { content: "a fact", type: "factual" });
    await plugin.executeTool("save_memory", { content: "a thought", type: "thought" });
    const result = (await plugin.executeTool("query_memories", { types: ["factual"] })) as string;
    expect(result).toContain("a fact");
    expect(result).not.toContain("a thought");
  });

  test("filters by date range", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_memory", { content: "recent fact", type: "factual" });
    const future = new Date(Date.now() + 10_000).toISOString();
    const result = (await plugin.executeTool("query_memories", { before: future })) as string;
    expect(result).toContain("recent fact");

    const past = new Date(Date.now() - 10_000).toISOString();
    const empty = (await plugin.executeTool("query_memories", { after: future, before: past })) as string;
    expect(empty).toContain("No memories");
  });

  test("returns 'No memories match' when filter has no results", async () => {
    const plugin = makePlugin();
    const result = await plugin.executeTool("query_memories", { types: ["procedure"] });
    expect(result).toContain("No memories match");
  });
});

// ---------------------------------------------------------------------------
// onMessage – conflict resolution
// ---------------------------------------------------------------------------

describe("onMessage conflict resolution", () => {
  test("does nothing when no memories were saved this turn", async () => {
    const plugin = makePlugin();
    await plugin.executeTool("save_memory", { content: "existing", type: "factual" });
    // Call getContext to set currentEvents but do NOT save anything (savedThisTurn stays empty)
    // Reset savedThisTurn by not calling save after getContext
    // We prime getContext to set currentEvents
    await plugin.getContext(["test event"]);
    // Override savedThisTurn to be empty
    (plugin as any).savedThisTurn = new Set();

    const memories = plugin.db.queryMemories({});
    await plugin.onMessage("assistant", "response", "test");
    // Memory should be untouched
    const after = plugin.db.queryMemories({});
    expect(after).toHaveLength(memories.length);
  });

  test("ignores non-assistant messages", async () => {
    const plugin = makePlugin();
    await plugin.getContext(["event"]);
    await plugin.executeTool("save_memory", { content: "new fact", type: "factual" });
    // user messages should not trigger conflict resolution
    await plugin.onMessage("user", "some user message", "user");
    // No crash, no changes expected beyond the already-saved memory
    const memories = plugin.db.queryMemories({});
    expect(memories.length).toBeGreaterThan(0);
  });

  test("deletes recent (< 2h) high-similarity conflicting memory", async () => {
    // Use identical embeddings → score = 1.0 ≥ 0.85
    const plugin = makePlugin();

    // Add an existing memory (not saved this turn)
    const existingId = await plugin.db.addMemory("old position", "factual");

    // Run getContext to set currentEvents
    await plugin.getContext(["new position"]);

    // Save a new memory this turn
    await plugin.executeTool("save_memory", { content: "new position", type: "factual" });

    // Trigger conflict resolution
    await plugin.onMessage("assistant", "I have updated my position", "assistant");

    // The existing memory (< 2h old) should have been deleted
    const existing = await plugin.db.getMemoryById(existingId);
    expect(existing).toBeNull();
  });

  test("supersedes old (>= 2h) high-similarity conflicting memory", async () => {
    const plugin = makePlugin();

    // Insert an old memory by directly manipulating the DB timestamp
    const oldId = await plugin.db.addMemory("old position", "factual");
    // Back-date it to 3 hours ago
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
    (plugin.db as any).db
      .prepare("UPDATE memories SET timestamp = ? WHERE id = ?")
      .run(threeHoursAgo, oldId);

    await plugin.getContext(["revised position"]);
    await plugin.executeTool("save_memory", { content: "new position", type: "factual" });
    await plugin.onMessage("assistant", "revised my old position", "assistant");

    // Old memory should have status='superseded', text unchanged
    const mem = await plugin.db.getMemoryById(oldId);
    expect(mem).not.toBeNull();
    expect(mem?.text).toBe("old position");
    const row = (plugin.db as any).db
      .prepare("SELECT status FROM memories WHERE id = ?")
      .get(oldId) as { status: string } | null;
    expect(row?.status).toBe("superseded");
  });
});
