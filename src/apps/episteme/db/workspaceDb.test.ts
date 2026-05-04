import { test, expect, describe } from "bun:test";
import { WorkspaceDb } from "./workspaceDb.ts";

function makeDb(): WorkspaceDb {
  return new WorkspaceDb(":memory:");
}

function makeFile(overrides: Partial<Parameters<WorkspaceDb["upsertWorkspaceFile"]>[0]> = {}) {
  return {
    relPath: "notes/foo.md",
    content: "# Foo\n\nbody",
    mtime: 1_700_000_000_000,
    size: 16,
    contentHash: "abc123",
    firstLine: "# Foo",
    wordCount: 2,
    ...overrides,
  };
}

describe("WorkspaceDb - workspace files", () => {
  test("upsert + get round-trips all fields", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile());
    const r = db.getWorkspaceFile("notes/foo.md");
    expect(r).not.toBeNull();
    expect(r!.relPath).toBe("notes/foo.md");
    expect(r!.content).toBe("# Foo\n\nbody");
    expect(r!.mtime).toBe(1_700_000_000_000);
    expect(r!.size).toBe(16);
    expect(r!.contentHash).toBe("abc123");
    expect(r!.firstLine).toBe("# Foo");
    expect(r!.wordCount).toBe(2);
    expect(r!.indexedAt).toBeGreaterThan(0);
  });

  test("getWorkspaceFile returns null for missing path", () => {
    const db = makeDb();
    expect(db.getWorkspaceFile("nope.md")).toBeNull();
  });

  test("upsert overwrites previous row and updates indexedAt", async () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile({ contentHash: "v1", content: "v1" }));
    const first = db.getWorkspaceFile("notes/foo.md")!;
    await Bun.sleep(2);
    db.upsertWorkspaceFile(makeFile({ contentHash: "v2", content: "v2" }));
    const second = db.getWorkspaceFile("notes/foo.md")!;
    expect(second.contentHash).toBe("v2");
    expect(second.content).toBe("v2");
    expect(second.indexedAt).toBeGreaterThanOrEqual(first.indexedAt);
  });

  test("listWorkspaceFiles returns all rows ordered by rel_path", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile({ relPath: "b.md" }));
    db.upsertWorkspaceFile(makeFile({ relPath: "a.md" }));
    const rows = db.listWorkspaceFiles();
    expect(rows.map((r) => r.relPath)).toEqual(["a.md", "b.md"]);
  });

  test("deleteWorkspaceFile cascades to ws_file_links", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile({ relPath: "src.md" }));
    db.upsertWorkspaceFile(makeFile({ relPath: "tgt.md" }));
    db.replaceFileLinks("src.md", [
      { targetPath: "tgt.md", linkType: "wikilink", raw: "tgt" },
    ]);
    expect(db.getOutboundLinks("src.md").length).toBe(1);
    db.deleteWorkspaceFile("src.md");
    expect(db.getWorkspaceFile("src.md")).toBeNull();
    expect(db.getOutboundLinks("src.md").length).toBe(0);
  });

  test("searchWorkspaceFiles matches content, path, and first_line", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(
      makeFile({ relPath: "notes/alpha.md", content: "talks about quantum mechanics" }),
    );
    db.upsertWorkspaceFile(
      makeFile({ relPath: "notes/beta.md", content: "another note", firstLine: "beta heading" }),
    );
    const byContent = db.searchWorkspaceFiles("quantum");
    expect(byContent.map((r) => r.relPath)).toEqual(["notes/alpha.md"]);
    const byPath = db.searchWorkspaceFiles("beta");
    expect(byPath.map((r) => r.relPath)).toContain("notes/beta.md");
  });

  test("searchWorkspaceFiles returns FTS snippet excerpts", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(
      makeFile({
        relPath: "notes/long.md",
        content: "intro paragraph blah blah ... the quantum mechanics chapter follows here ...",
      }),
    );
    const hits = db.searchWorkspaceFiles("quantum");
    expect(hits.length).toBe(1);
    expect(hits[0]!.relPath).toBe("notes/long.md");
    expect(hits[0]!.excerpt.toLowerCase()).toContain("quantum");
  });

  test("searchWorkspaceFiles is updated when ws_files row is updated", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile({ relPath: "x.md", content: "first version mentions sandwiches" }));
    expect(db.searchWorkspaceFiles("sandwiches").length).toBe(1);
    db.upsertWorkspaceFile(makeFile({ relPath: "x.md", content: "second version mentions tacos" }));
    expect(db.searchWorkspaceFiles("sandwiches").length).toBe(0);
    expect(db.searchWorkspaceFiles("tacos").length).toBe(1);
  });

  test("searchWorkspaceFiles is updated when ws_files row is deleted", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile({ relPath: "y.md", content: "uniquetokenfoo" }));
    expect(db.searchWorkspaceFiles("uniquetokenfoo").length).toBe(1);
    db.deleteWorkspaceFile("y.md");
    expect(db.searchWorkspaceFiles("uniquetokenfoo").length).toBe(0);
  });

  test("searchWorkspaceFiles ANDs multi-word queries", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile({ relPath: "a.md", content: "alpha and beta together" }));
    db.upsertWorkspaceFile(makeFile({ relPath: "b.md", content: "alpha alone" }));
    const both = db.searchWorkspaceFiles("alpha beta");
    expect(both.map((r) => r.relPath)).toEqual(["a.md"]);
  });

  test("searchWorkspaceFiles returns [] for empty query", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile());
    expect(db.searchWorkspaceFiles("").length).toBe(0);
    expect(db.searchWorkspaceFiles("   ").length).toBe(0);
  });
});

describe("WorkspaceDb - file links", () => {
  test("replaceFileLinks deletes prior rows and inserts new ones atomically", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile({ relPath: "src.md" }));
    db.upsertWorkspaceFile(makeFile({ relPath: "a.md" }));
    db.upsertWorkspaceFile(makeFile({ relPath: "b.md" }));
    db.replaceFileLinks("src.md", [
      { targetPath: "a.md", linkType: "wikilink", raw: "a" },
    ]);
    expect(db.getOutboundLinks("src.md").map((l) => l.targetPath)).toEqual(["a.md"]);
    db.replaceFileLinks("src.md", [
      { targetPath: "b.md", linkType: "wikilink", raw: "b" },
    ]);
    expect(db.getOutboundLinks("src.md").map((l) => l.targetPath)).toEqual(["b.md"]);
  });

  test("getAllLinks returns every edge", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile({ relPath: "src.md" }));
    db.upsertWorkspaceFile(makeFile({ relPath: "a.md" }));
    db.upsertWorkspaceFile(makeFile({ relPath: "b.md" }));
    db.replaceFileLinks("src.md", [
      { targetPath: "a.md", linkType: "wikilink", raw: "a" },
      { targetPath: "b.md", linkType: "markdown", raw: "./b.md" },
    ]);
    expect(db.getAllLinks().length).toBe(2);
  });

  test("duplicate (source, target, type) inserts are ignored", () => {
    const db = makeDb();
    db.upsertWorkspaceFile(makeFile({ relPath: "src.md" }));
    db.upsertWorkspaceFile(makeFile({ relPath: "a.md" }));
    db.replaceFileLinks("src.md", [
      { targetPath: "a.md", linkType: "wikilink", raw: "a" },
      { targetPath: "a.md", linkType: "wikilink", raw: "a-again" },
    ]);
    expect(db.getOutboundLinks("src.md").length).toBe(1);
  });
});

describe("WorkspaceDb - contradictions", () => {
  test("recordContradiction + listContradictions round-trips", () => {
    const db = makeDb();
    const id = db.recordContradiction({
      summary: "X is both true and false",
      sourceAId: "memA",
      sourceBId: "memB",
      sourceAText: "X is true",
      sourceBText: "X is false",
    });
    const list = db.listContradictions();
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe(id);
    expect(list[0]!.summary).toBe("X is both true and false");
    expect(list[0]!.sourceAId).toBe("memA");
    expect(list[0]!.sourceBId).toBe("memB");
    expect(list[0]!.createdAt).toBeGreaterThan(0);
  });

  test("contradictionPairExists returns true regardless of order", () => {
    const db = makeDb();
    db.recordContradiction({
      summary: "s",
      sourceAId: "a",
      sourceBId: "b",
      sourceAText: "ta",
      sourceBText: "tb",
    });
    expect(db.contradictionPairExists("a", "b")).toBe(true);
    expect(db.contradictionPairExists("b", "a")).toBe(true);
    expect(db.contradictionPairExists("a", "c")).toBe(false);
  });

  test("recording the same pair twice does not duplicate", () => {
    const db = makeDb();
    db.recordContradiction({
      summary: "first",
      sourceAId: "a",
      sourceBId: "b",
      sourceAText: "ta",
      sourceBText: "tb",
    });
    db.recordContradiction({
      summary: "second",
      sourceAId: "a",
      sourceBId: "b",
      sourceAText: "ta2",
      sourceBText: "tb2",
    });
    const list = db.listContradictions();
    expect(list.length).toBe(1);
    expect(list[0]!.summary).toBe("second");
  });
});

describe("WorkspaceDb - ingestions", () => {
  test("recordIngestedUrl upserts on duplicate URL", () => {
    const db = makeDb();
    db.recordIngestedUrl({
      url: "https://example.com",
      slug: "example",
      summary: "first",
      filePath: "research/example.md",
    });
    db.recordIngestedUrl({
      url: "https://example.com",
      slug: "example",
      summary: "second",
      filePath: "research/example.md",
    });
    expect(db.listIngestedUrls().length).toBe(1);
    expect(db.getIngestedUrl("https://example.com")!.summary).toBe("second");
  });

  test("recordIngestedPdf upserts on duplicate path", () => {
    const db = makeDb();
    db.recordIngestedPdf({
      relPath: "papers/foo.pdf",
      structuredContent: "v1",
      filePath: ".episteme/ingested/foo.md",
    });
    db.recordIngestedPdf({
      relPath: "papers/foo.pdf",
      structuredContent: "v2",
      filePath: ".episteme/ingested/foo.md",
    });
    expect(db.listIngestedPdfs().length).toBe(1);
    expect(db.getIngestedPdf("papers/foo.pdf")!.structuredContent).toBe("v2");
  });
});
