import { test, expect, describe, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StyleGuidePlugin } from "./StyleGuidePlugin.ts";

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()!;
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "episteme-style-test-"));
  tmpDirs.push(dir);
  await mkdir(join(dir, ".episteme"), { recursive: true });
  return dir;
}

async function init(root: string): Promise<StyleGuidePlugin> {
  const plugin = new StyleGuidePlugin(root);
  await plugin.onInit();
  return plugin;
}

describe("StyleGuidePlugin — fresh workspace", () => {
  test("starts empty with no fragment", async () => {
    const root = await makeWorkspace();
    const plugin = await init(root);
    expect(plugin.listSections()).toEqual([]);
    expect(plugin.getSystemPromptFragment()).toBe("");
    // Manifest written so migration is idempotent next boot.
    expect(await Bun.file(join(root, ".episteme", "style-guide", "manifest.json")).exists()).toBe(true);
  });
});

describe("StyleGuidePlugin — migration", () => {
  test("imports legacy style-guide.md into a Default section and backs it up", async () => {
    const root = await makeWorkspace();
    await writeFile(join(root, ".episteme", "style-guide.md"), "Use active voice.");
    const plugin = await init(root);

    const sections = plugin.listSections();
    expect(sections.length).toBe(1);
    expect(sections[0]!.id).toBe("default");
    expect(sections[0]!.title).toBe("Default");
    expect(sections[0]!.body).toBe("Use active voice.");
    expect(plugin.getSystemPromptFragment()).toContain("Use active voice.");

    // Legacy file moved aside, not deleted.
    expect(await Bun.file(join(root, ".episteme", "style-guide.md")).exists()).toBe(false);
    expect(await Bun.file(join(root, ".episteme", "style-guide.legacy.md")).exists()).toBe(true);
  });

  test("is idempotent — second init does not re-migrate", async () => {
    const root = await makeWorkspace();
    await writeFile(join(root, ".episteme", "style-guide.md"), "Original.");
    await init(root);
    // Recreate a stray legacy file; a re-init must ignore it (manifest exists).
    await writeFile(join(root, ".episteme", "style-guide.md"), "Should be ignored.");
    const plugin = await init(root);
    expect(plugin.listSections().length).toBe(1);
    expect(plugin.listSections()[0]!.body).toBe("Original.");
  });
});

describe("StyleGuidePlugin — CRUD", () => {
  test("create, update, delete persist across reload", async () => {
    const root = await makeWorkspace();
    const plugin = await init(root);

    const a = await plugin.createSection({ title: "Voice", body: "Be concise." });
    expect(a.id).toBe("voice");
    expect(a.order).toBe(0);
    expect(a.enabled).toBe(true);

    await plugin.updateSection(a.id, { body: "Be very concise.", enabled: false });

    const fresh = new StyleGuidePlugin(root);
    await fresh.onInit();
    const reloaded = fresh.listSections();
    expect(reloaded.length).toBe(1);
    expect(reloaded[0]!.body).toBe("Be very concise.");
    expect(reloaded[0]!.enabled).toBe(false);
    // Disabled → no fragment.
    expect(fresh.getSystemPromptFragment()).toBe("");

    await fresh.deleteSection(a.id);
    expect(fresh.listSections()).toEqual([]);
    expect(await Bun.file(join(root, ".episteme", "style-guide", "voice.md")).exists()).toBe(false);
  });

  test("slug collisions get a numeric suffix", async () => {
    const root = await makeWorkspace();
    const plugin = await init(root);
    const a = await plugin.createSection({ title: "Default", body: "one" });
    const b = await plugin.createSection({ title: "Default", body: "two" });
    expect(a.id).toBe("default");
    expect(b.id).toBe("default-2");
  });

  test("reorder rewrites order ascending", async () => {
    const root = await makeWorkspace();
    const plugin = await init(root);
    const a = await plugin.createSection({ title: "A", body: "a" });
    const b = await plugin.createSection({ title: "B", body: "b" });
    const c = await plugin.createSection({ title: "C", body: "c" });

    await plugin.reorder([c.id, a.id, b.id]);
    const ordered = plugin.listSections().map((s) => s.id);
    expect(ordered).toEqual([c.id, a.id, b.id]);
    expect(plugin.listSections().map((s) => s.order)).toEqual([0, 1, 2]);
  });
});

describe("StyleGuidePlugin — fragment + budget", () => {
  test("concatenates enabled sections in order with a header", async () => {
    const root = await makeWorkspace();
    const plugin = await init(root);
    const a = await plugin.createSection({ title: "First", body: "Alpha rule." });
    const b = await plugin.createSection({ title: "Second", body: "Beta rule." });
    await plugin.reorder([b.id, a.id]);

    const fragment = plugin.getSystemPromptFragment();
    expect(fragment.startsWith("## Style Guide")).toBe(true);
    expect(fragment.indexOf("Beta rule.")).toBeLessThan(fragment.indexOf("Alpha rule."));
    expect(fragment).toContain("### Second");
  });

  test("drops trailing sections over the 4,000-char budget", async () => {
    const root = await makeWorkspace();
    const plugin = await init(root);
    const big = "x".repeat(3000);
    await plugin.createSection({ title: "One", body: big });
    const dropped = await plugin.createSection({ title: "Two", body: big });

    const budget = plugin.getBudget();
    expect(budget.cap).toBe(4000);
    expect(budget.used).toBe(6000);
    expect(budget.droppedSectionIds).toEqual([dropped.id]);
    // Dropped section's body is absent from the prompt.
    expect(plugin.getSystemPromptFragment()).not.toContain("### Two");
  });
});

describe("StyleGuidePlugin — library", () => {
  test("imports a starter section by slug", async () => {
    const root = await makeWorkspace();
    const plugin = await init(root);
    const section = await plugin.importFromLibrary("concise-voice");
    expect(section.title).toBe("Concise voice");
    expect(section.body.length).toBeGreaterThan(0);
    expect(plugin.listSections().length).toBe(1);
  });

  test("rejects an unknown slug", async () => {
    const root = await makeWorkspace();
    const plugin = await init(root);
    await expect(plugin.importFromLibrary("nope")).rejects.toThrow();
  });
});
