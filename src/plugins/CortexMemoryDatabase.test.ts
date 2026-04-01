import { test, expect, describe, mock } from "bun:test";
import { CortexMemoryDatabase } from "./CortexMemoryDatabase";

// Use ":memory:" to avoid file I/O in tests
function makeDB(embeddingDim = 4) {
  const getEmbedding = mock(async (text: string) => {
    // Deterministic embedding: hash-based so identical texts return the same vector
    const seed = text.charCodeAt(0) || 1;
    return Array.from({ length: embeddingDim }, (_, i) => ((seed + i) % 10) / 10);
  });
  const llm = { getEmbedding };
  const db = new CortexMemoryDatabase(llm, "test", ":memory:");
  return { db, getEmbedding };
}

describe("CortexMemoryDatabase - schema initialization", () => {
  test("memories table is created", async () => {
    const { db } = makeDB();
    // addMemory uses the table — if schema didn't initialize it would throw
    const id = await db.addMemory("hello", "factual");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("memory_links table is created", async () => {
    const { db } = makeDB();
    const idA = await db.addMemory("a", "factual");
    const idB = await db.addMemory("b", "factual");
    // linkMemories uses memory_links — throws if table missing
    await expect(db.linkMemories(idA, idB)).resolves.toBeUndefined();
  });

  test("fts5 virtual table (memories_fts) is created", async () => {
    const { db } = makeDB();
    await db.addMemory("searchable text", "factual");
    // queryMemories with contains uses fts5
    const results = db.queryMemories({ contains: "searchable" });
    expect(results.length).toBeGreaterThan(0);
  });
});

describe("CortexMemoryDatabase - cosine similarity", () => {
  test("identical vectors return score of 1", async () => {
    const { db } = makeDB();
    // Insert a memory, then search with the same embedding
    const vec = [1, 0, 0, 0];
    const llmExact = { getEmbedding: mock(async () => vec) };
    const dbExact = new CortexMemoryDatabase(llmExact, "test", ":memory:");
    await dbExact.addMemory("exact", "factual");
    const results = dbExact.searchWithEmbedding(vec, 1, 0);
    expect(results[0]?.score).toBeCloseTo(1.0, 5);
  });

  test("orthogonal vectors return score of 0 (filtered below threshold)", async () => {
    const { db } = makeDB();
    const llmA = { getEmbedding: mock(async () => [1, 0, 0, 0]) };
    const dbA = new CortexMemoryDatabase(llmA, "test", ":memory:");
    await dbA.addMemory("a", "factual");
    // Query with orthogonal vector
    const results = dbA.searchWithEmbedding([0, 1, 0, 0], 5, 0);
    expect(results[0]?.score).toBeCloseTo(0, 5);
  });

  test("zero-norm query vector returns 0 (no NaN/crash)", async () => {
    const llmZero = { getEmbedding: mock(async () => [1, 0, 0, 0]) };
    const dbZero = new CortexMemoryDatabase(llmZero, "test", ":memory:");
    await dbZero.addMemory("something", "factual");
    const results = dbZero.searchWithEmbedding([0, 0, 0, 0], 5, 0);
    expect(results[0]?.score).toBe(0);
  });

  test("zero-norm stored vector returns 0 (no NaN/crash)", async () => {
    const llmZero = { getEmbedding: mock(async () => [0, 0, 0, 0]) };
    const dbZero = new CortexMemoryDatabase(llmZero, "test", ":memory:");
    await dbZero.addMemory("empty", "factual");
    const results = dbZero.searchWithEmbedding([1, 0, 0, 0], 5, 0);
    expect(results[0]?.score).toBe(0);
  });
});

describe("CortexMemoryDatabase - CRUD", () => {
  test("addMemory returns an ID string", async () => {
    const { db } = makeDB();
    const id = await db.addMemory("test memory", "factual");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("getMemoryById returns the memory", async () => {
    const { db } = makeDB();
    const id = await db.addMemory("stored content", "factual");
    const mem = await db.getMemoryById(id);
    expect(mem?.text).toBe("stored content");
    expect(mem?.type).toBe("factual");
  });

  test("getMemoryById returns null for unknown ID", async () => {
    const { db } = makeDB();
    const mem = await db.getMemoryById("nonexistent-id");
    expect(mem).toBeNull();
  });

  test("updateMemoryText changes the content", async () => {
    const { db, getEmbedding } = makeDB();
    const id = await db.addMemory("original", "factual");
    await db.updateMemoryText(id, "updated");
    const mem = await db.getMemoryById(id);
    expect(mem?.text).toBe("updated");
  });

  test("deleteMemory removes the row", async () => {
    const { db } = makeDB();
    const id = await db.addMemory("to be deleted", "factual");
    await db.deleteMemory(id);
    const mem = await db.getMemoryById(id);
    expect(mem).toBeNull();
  });

  test("deleteMemory removes associated links", async () => {
    const { db } = makeDB();
    const idA = await db.addMemory("a", "factual");
    const idB = await db.addMemory("b", "factual");
    await db.linkMemories(idA, idB);
    await db.deleteMemory(idA);
    // idB should no longer have linked memories since idA is gone
    const linked = await db.getLinkedMemories(idB);
    expect(linked.find((m) => m.id === idA)).toBeUndefined();
  });

  test("embedding is stored and retrieved as same float array", async () => {
    const fixedVec = [0.1, 0.2, 0.3, 0.4];
    const llmFixed = { getEmbedding: mock(async () => fixedVec) };
    const dbFixed = new CortexMemoryDatabase(llmFixed, "test", ":memory:");
    await dbFixed.addMemory("vector test", "factual");
    const results = dbFixed.searchWithEmbedding(fixedVec, 5, 0);
    // If embedding is stored/retrieved correctly, score should be ~1.0
    expect(results[0]?.score).toBeCloseTo(1.0, 5);
  });
});

describe("CortexMemoryDatabase - linking", () => {
  test("linkMemories creates bidirectional links", async () => {
    const { db } = makeDB();
    const idA = await db.addMemory("A", "factual");
    const idB = await db.addMemory("B", "factual");
    await db.linkMemories(idA, idB);

    const linkedFromA = await db.getLinkedMemories(idA);
    const linkedFromB = await db.getLinkedMemories(idB);

    expect(linkedFromA.some((m) => m.id === idB)).toBe(true);
    expect(linkedFromB.some((m) => m.id === idA)).toBe(true);
  });

  test("duplicate links are silently ignored (INSERT OR IGNORE)", async () => {
    const { db } = makeDB();
    const idA = await db.addMemory("A", "factual");
    const idB = await db.addMemory("B", "factual");
    await db.linkMemories(idA, idB);
    // Should not throw on duplicate
    await expect(db.linkMemories(idA, idB)).resolves.toBeUndefined();

    const linked = await db.getLinkedMemories(idA);
    // idB should appear exactly once
    expect(linked.filter((m) => m.id === idB)).toHaveLength(1);
  });

  test("getLinkedMemories returns memories from both directions", async () => {
    const { db } = makeDB();
    const idA = await db.addMemory("A", "factual");
    const idB = await db.addMemory("B", "factual");
    const idC = await db.addMemory("C", "factual");
    await db.linkMemories(idA, idB); // also creates B→A
    await db.linkMemories(idC, idA); // also creates A→C

    const linkedFromA = await db.getLinkedMemories(idA);
    const ids = linkedFromA.map((m) => m.id);
    expect(ids).toContain(idB);
    expect(ids).toContain(idC);
  });
});

describe("CortexMemoryDatabase - date filtering (toMs)", () => {
  test("numeric timestamp is accepted in after filter", async () => {
    const { db } = makeDB();
    const before = Date.now() - 1000;
    await db.addMemory("recent", "factual");
    const results = db.queryMemories({ after: before });
    expect(results.length).toBeGreaterThan(0);
  });

  test("ISO date string is accepted in before filter", async () => {
    const { db } = makeDB();
    await db.addMemory("old", "factual");
    const future = new Date(Date.now() + 10_000).toISOString();
    const results = db.queryMemories({ before: future });
    expect(results.length).toBeGreaterThan(0);
  });

  test("after filter excludes entries before the cutoff", async () => {
    const { db } = makeDB();
    await db.addMemory("early", "factual");
    const future = Date.now() + 10_000;
    const results = db.queryMemories({ after: future });
    expect(results).toHaveLength(0);
  });
});

describe("CortexMemoryDatabase - WHERE clause builder (via queryMemories)", () => {
  test("types filter returns only matching types", async () => {
    const { db } = makeDB();
    await db.addMemory("fact", "factual");
    await db.addMemory("thought", "thought");
    const results = db.queryMemories({ types: ["factual"] });
    expect(results.every((r) => r.type === "factual")).toBe(true);
  });

  test("tags filter returns only memories with the tag", async () => {
    const { db } = makeDB();
    await db.addMemory("tagged", "factual", ["important"]);
    await db.addMemory("untagged", "factual", []);
    const results = db.queryMemories({ tags: ["important"] });
    expect(results.some((r) => r.text === "tagged")).toBe(true);
    expect(results.every((r) => r.tags.includes("important"))).toBe(true);
  });

  test("contains filter performs FTS5 search", async () => {
    const { db } = makeDB();
    await db.addMemory("the quick brown fox", "factual");
    await db.addMemory("hello world", "factual");
    const results = db.queryMemories({ contains: "fox" });
    expect(results.some((r) => r.text.includes("fox"))).toBe(true);
    expect(results.every((r) => r.text.includes("fox"))).toBe(true);
  });

  test("empty filter returns all memories", async () => {
    const { db } = makeDB();
    await db.addMemory("one", "factual");
    await db.addMemory("two", "thought");
    const results = db.queryMemories({});
    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});

describe("CortexMemoryDatabase - chunkAndEmbed", () => {
  // CHUNK_SIZE_CHARS = 6000, CHUNK_OVERLAP_CHARS = 800, stride = 5200

  test("short text (≤6000 chars) calls getEmbedding exactly once with the original text", async () => {
    const { db, getEmbedding } = makeDB();
    getEmbedding.mockClear?.();
    await db.addMemory("short text", "factual");
    expect(getEmbedding.mock.calls.length).toBe(1);
    expect(getEmbedding.mock.calls[0]?.[0]).toBe("short text");
  });

  test("text exactly at 6000 chars calls getEmbedding once (boundary, no chunking)", async () => {
    const { db, getEmbedding } = makeDB();
    getEmbedding.mockClear?.();
    await db.addMemory("x".repeat(6000), "factual");
    expect(getEmbedding.mock.calls.length).toBe(1);
  });

  test("text at 6001 chars triggers chunking (2 getEmbedding calls)", async () => {
    const { db, getEmbedding } = makeDB();
    getEmbedding.mockClear?.();
    await db.addMemory("x".repeat(6001), "factual");
    expect(getEmbedding.mock.calls.length).toBe(2);
  });

  test("chunks overlap by 800 chars", async () => {
    // Use a text where each character encodes its position so we can verify the overlap
    const text = Array.from({ length: 6001 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
    const captured: string[] = [];
    const llm = { getEmbedding: mock(async (t: string) => { captured.push(t); return [0.1, 0.2, 0.3, 0.4]; }) };
    const db = new CortexMemoryDatabase(llm, "test", ":memory:");
    await db.addMemory(text, "factual");
    // Last 800 chars of chunk[0] should equal first 800 chars of chunk[1]
    expect(captured[0]!.slice(-800)).toBe(captured[1]!.slice(0, 800));
  });

  test("averaged embedding is stored — searching with the weighted average returns score ~1", async () => {
    // "x".repeat(6001) → chunk1: [0..5999] = 6000 chars, chunk2: [5200..6000] = 801 chars
    // weighted avg weights each embedding by its chunk's share of total chars (6801)
    const chunkEmbeddings: [number, number][] = [[0.0, 1.0], [1.0, 0.0]];
    let callCount = 0;
    const llm = {
      getEmbedding: mock(async (_t: string) => chunkEmbeddings[callCount++]!),
    };
    const db = new CortexMemoryDatabase(llm, "test", ":memory:");
    await db.addMemory("x".repeat(6001), "factual");
    const w1 = 6000 / 6801;
    const w2 = 801 / 6801;
    const expectedAvg = [
      chunkEmbeddings[0][0] * w1 + chunkEmbeddings[1][0] * w2,
      chunkEmbeddings[0][1] * w1 + chunkEmbeddings[1][1] * w2,
    ];
    // Cosine similarity of the stored vector against itself is 1.0
    const results = db.searchWithEmbedding(expectedAvg, 1, 0);
    expect(results[0]?.score).toBeCloseTo(1.0, 5);
  });

  test("three-chunk text calls getEmbedding 3 times", async () => {
    // stride = 5200; need length > 5200*2 = 10400 to get a third chunk
    const { db, getEmbedding } = makeDB();
    getEmbedding.mockClear?.();
    await db.addMemory("x".repeat(10401), "factual");
    expect(getEmbedding.mock.calls.length).toBe(3);
  });

  test("updateMemoryText uses chunked embedding for long text", async () => {
    const { db, getEmbedding } = makeDB();
    const id = await db.addMemory("short", "factual");
    getEmbedding.mockClear?.();
    await db.updateMemoryText(id, "y".repeat(6001));
    expect(getEmbedding.mock.calls.length).toBe(2);
  });

  test("updateMemoryText calls getEmbedding once for short updated text", async () => {
    const { db, getEmbedding } = makeDB();
    const id = await db.addMemory("original", "factual");
    getEmbedding.mockClear?.();
    await db.updateMemoryText(id, "updated short text");
    expect(getEmbedding.mock.calls.length).toBe(1);
  });
});

describe("CortexMemoryDatabase - getRecentMemories", () => {
  test("respects the limit parameter", async () => {
    const { db } = makeDB();
    for (let i = 0; i < 5; i++) {
      await db.addMemory(`memory ${i}`, "factual");
    }
    const results = db.getRecentMemories(3);
    expect(results).toHaveLength(3);
  });

  test("filters by type when provided", async () => {
    const { db } = makeDB();
    await db.addMemory("a fact", "factual");
    await db.addMemory("a thought", "thought");
    const results = db.getRecentMemories(10, "factual");
    expect(results.every((r) => "factual" === (r as any).type || r.text === "a fact")).toBe(true);
  });

  test("returns most recent first", async () => {
    const { db } = makeDB();
    await db.addMemory("older", "factual");
    await new Promise((r) => setTimeout(r, 2));
    await db.addMemory("newer", "factual");
    const results = db.getRecentMemories(2);
    expect(results[0]?.text).toBe("newer");
  });
});
