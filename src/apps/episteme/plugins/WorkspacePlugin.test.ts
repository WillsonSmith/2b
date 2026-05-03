import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspacePlugin } from "./WorkspacePlugin.ts";
import { WorkspaceDb } from "../db/workspaceDb.ts";
import { buildKnowledgeGraph } from "../features/contradiction.ts";

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "episteme-ws-test-"));
  tmpDirs.push(dir);
  return dir;
}

describe("WorkspacePlugin.index() — wikilink resolution", () => {
  test("indexes files and stores resolved wikilinks", async () => {
    const root = await makeTempWorkspace();
    await mkdir(join(root, "notes"), { recursive: true });
    await writeFile(join(root, "notes", "alpha.md"), "links to [[notes/beta]] here");
    await writeFile(join(root, "notes", "beta.md"), "# Beta\nplain content");

    const db = new WorkspaceDb(":memory:");
    const plugin = new WorkspacePlugin(root, null, db);
    await plugin.index();

    const links = db.getOutboundLinks("notes/alpha.md");
    expect(links.length).toBe(1);
    expect(links[0]!.targetPath).toBe("notes/beta.md");
    expect(links[0]!.linkType).toBe("wikilink");
  });

  test("basename-only wikilink resolves to the matching file", async () => {
    const root = await makeTempWorkspace();
    await writeFile(join(root, "src.md"), "I reference [[target]] here.");
    await mkdir(join(root, "deep", "nested"), { recursive: true });
    await writeFile(join(root, "deep", "nested", "target.md"), "ok");

    const db = new WorkspaceDb(":memory:");
    const plugin = new WorkspacePlugin(root, null, db);
    await plugin.index();

    const links = db.getOutboundLinks("src.md");
    expect(links.length).toBe(1);
    expect(links[0]!.targetPath).toBe("deep/nested/target.md");
  });

  test("aliased wikilink resolves the target, ignores alias", async () => {
    const root = await makeTempWorkspace();
    await writeFile(join(root, "src.md"), "see [[foo|Friendly Name]]");
    await writeFile(join(root, "foo.md"), "ok");

    const db = new WorkspaceDb(":memory:");
    const plugin = new WorkspacePlugin(root, null, db);
    await plugin.index();

    const links = db.getOutboundLinks("src.md");
    expect(links.length).toBe(1);
    expect(links[0]!.targetPath).toBe("foo.md");
  });

  test("unchanged file is skipped on second index", async () => {
    const root = await makeTempWorkspace();
    await writeFile(join(root, "stable.md"), "content");

    const db = new WorkspaceDb(":memory:");
    const plugin = new WorkspacePlugin(root, null, db);
    const first = (await plugin.index()) as { indexed: number; skipped: number };
    expect(first.indexed).toBe(1);
    expect(first.skipped).toBe(0);

    const second = (await plugin.index()) as { indexed: number; skipped: number };
    expect(second.indexed).toBe(0);
    expect(second.skipped).toBe(1);
  });

  test("deleted file is pruned from ws_files on next index", async () => {
    const root = await makeTempWorkspace();
    await writeFile(join(root, "keep.md"), "still here");
    await writeFile(join(root, "gone.md"), "will be removed");

    const db = new WorkspaceDb(":memory:");
    const plugin = new WorkspacePlugin(root, null, db);
    await plugin.index();
    expect(db.getWorkspaceFile("gone.md")).not.toBeNull();

    await rm(join(root, "gone.md"));
    const result = (await plugin.index()) as { deleted: number };
    expect(result.deleted).toBe(1);
    expect(db.getWorkspaceFile("gone.md")).toBeNull();
    expect(db.getWorkspaceFile("keep.md")).not.toBeNull();
  });
});

describe("buildKnowledgeGraph — wikilink edges", () => {
  test("emits a document-link edge between files connected by [[wikilink]]", async () => {
    const root = await makeTempWorkspace();
    await writeFile(join(root, "src.md"), "this links to [[target]]");
    await writeFile(join(root, "target.md"), "ok");

    const db = new WorkspaceDb(":memory:");
    const plugin = new WorkspacePlugin(root, null, db);
    await plugin.index();

    // The graph builder takes a memory plugin too; pass a stub that returns no
    // memories so we can assert purely on the structural edges.
    const memoryStub = {
      queryMemoriesRaw: () => [],
    } as unknown as Parameters<typeof buildKnowledgeGraph>[0];

    const graph = buildKnowledgeGraph(memoryStub, db);
    const fileNodes = graph.nodes.filter((n) => n.type === "workspace-file");
    expect(fileNodes.length).toBe(2);

    const docLinks = graph.links.filter((l) => l.linkType === "document-link");
    expect(docLinks.length).toBe(1);
    expect(docLinks[0]!.source).toBe("file:src.md");
    expect(docLinks[0]!.target).toBe("file:target.md");
  });
});
