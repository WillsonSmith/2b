import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { ScratchPlugin } from "./ScratchPlugin";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SESSION_ID = "test-scratch-session";

let plugin: ScratchPlugin;

beforeEach(() => {
  plugin = new ScratchPlugin(SESSION_ID);
});

afterEach(async () => {
  await rm(join(tmpdir(), `agent-${SESSION_ID}`), { recursive: true, force: true });
});

// ── scratch_write ─────────────────────────────────────────────────────────────

describe("scratch_write", () => {
  test("writes a file and returns name and size", async () => {
    const result = (await plugin.executeTool("scratch_write", {
      name: "my-file",
      content: "hello world",
    })) as any;
    expect(result.name).toBe("my-file");
    expect(result.size).toBe(11);
  });

  test("overwrites an existing file", async () => {
    await plugin.executeTool("scratch_write", { name: "overwrite-me", content: "first" });
    await plugin.executeTool("scratch_write", { name: "overwrite-me", content: "second" });
    const result = (await plugin.executeTool("scratch_read", { name: "overwrite-me" })) as any;
    expect(result.content).toBe("second");
  });

  test("creates the session directory on first write", async () => {
    await plugin.executeTool("scratch_write", { name: "first", content: "x" });
    const list = (await plugin.executeTool("scratch_list", {})) as any;
    expect(list.files.some((f: any) => f.name === "first")).toBe(true);
  });

  test("rejects content over 1 MB", async () => {
    const big = "x".repeat(1024 * 1024 + 1);
    await expect(
      plugin.executeTool("scratch_write", { name: "big", content: big }),
    ).rejects.toThrow("exceeds the");
  });

  test("rejects invalid name with path separator", async () => {
    await expect(
      plugin.executeTool("scratch_write", { name: "foo/bar", content: "x" }),
    ).rejects.toThrow("Invalid scratch file name");
  });

  test("rejects path traversal attempts", async () => {
    await expect(
      plugin.executeTool("scratch_write", { name: "../escape", content: "x" }),
    ).rejects.toThrow("Invalid scratch file name");
  });

  test("rejects bare dot name", async () => {
    await expect(
      plugin.executeTool("scratch_write", { name: ".", content: "x" }),
    ).rejects.toThrow("Invalid scratch file name");
  });

  test("accepts names with hyphens, underscores, and dots", async () => {
    await expect(
      plugin.executeTool("scratch_write", { name: "my-file_v2.ts", content: "ok" }),
    ).resolves.toBeDefined();
  });
});

// ── scratch_read ──────────────────────────────────────────────────────────────

describe("scratch_read", () => {
  test("returns the full content of a written file", async () => {
    await plugin.executeTool("scratch_write", { name: "notes", content: "important text" });
    const result = (await plugin.executeTool("scratch_read", { name: "notes" })) as any;
    expect(result.content).toBe("important text");
    expect(result.name).toBe("notes");
    expect(result.size).toBe(14);
  });

  test("preserves multiline content exactly", async () => {
    const content = "line1\nline2\nline3";
    await plugin.executeTool("scratch_write", { name: "multiline", content });
    const result = (await plugin.executeTool("scratch_read", { name: "multiline" })) as any;
    expect(result.content).toBe(content);
  });

  test("throws with a helpful message when file does not exist", async () => {
    await expect(
      plugin.executeTool("scratch_read", { name: "ghost" }),
    ).rejects.toThrow("scratch_list");
  });
});

// ── scratch_list ──────────────────────────────────────────────────────────────

describe("scratch_list", () => {
  test("returns empty files array when nothing has been written", async () => {
    const result = (await plugin.executeTool("scratch_list", {})) as any;
    expect(result.files).toEqual([]);
  });

  test("lists all written files sorted by name", async () => {
    await plugin.executeTool("scratch_write", { name: "zebra", content: "z" });
    await plugin.executeTool("scratch_write", { name: "alpha", content: "a" });
    await plugin.executeTool("scratch_write", { name: "mango", content: "m" });
    const result = (await plugin.executeTool("scratch_list", {})) as any;
    const names = result.files.map((f: any) => f.name);
    expect(names).toEqual(["alpha", "mango", "zebra"]);
  });

  test("includes size for each file", async () => {
    await plugin.executeTool("scratch_write", { name: "sized", content: "12345" });
    const result = (await plugin.executeTool("scratch_list", {})) as any;
    const file = result.files.find((f: any) => f.name === "sized");
    expect(file.size).toBe(5);
  });
});

// ── scratch_delete ────────────────────────────────────────────────────────────

describe("scratch_delete", () => {
  test("removes a file and it no longer appears in list", async () => {
    await plugin.executeTool("scratch_write", { name: "to-delete", content: "bye" });
    await plugin.executeTool("scratch_delete", { name: "to-delete" });
    const result = (await plugin.executeTool("scratch_list", {})) as any;
    expect(result.files.some((f: any) => f.name === "to-delete")).toBe(false);
  });

  test("returns the deleted file name", async () => {
    await plugin.executeTool("scratch_write", { name: "gone", content: "x" });
    const result = (await plugin.executeTool("scratch_delete", { name: "gone" })) as any;
    expect(result.name).toBe("gone");
  });

  test("throws when file does not exist", async () => {
    await expect(
      plugin.executeTool("scratch_delete", { name: "nonexistent" }),
    ).rejects.toThrow("not found");
  });
});

// ── getContext ────────────────────────────────────────────────────────────────

describe("getContext", () => {
  test("returns empty string when no files exist", async () => {
    const ctx = await plugin.getContext();
    expect(ctx).toBe("");
  });

  test("includes file names in context after writing", async () => {
    await plugin.executeTool("scratch_write", { name: "auth-middleware", content: "code here" });
    await plugin.executeTool("scratch_write", { name: "api-schema", content: "schema here" });
    const ctx = await plugin.getContext();
    expect(ctx).toContain("auth-middleware");
    expect(ctx).toContain("api-schema");
  });

  test("context disappears after all files are deleted", async () => {
    await plugin.executeTool("scratch_write", { name: "temp", content: "x" });
    await plugin.executeTool("scratch_delete", { name: "temp" });
    const ctx = await plugin.getContext();
    expect(ctx).toBe("");
  });
});

// ── active goal ───────────────────────────────────────────────────────────────

describe("active goal", () => {
  test("get_active_goal returns null when no goal is set", async () => {
    const result = (await plugin.executeTool("get_active_goal", {})) as any;
    expect(result.goal).toBeNull();
  });

  test("set_active_goal stores the goal and returns it", async () => {
    const result = (await plugin.executeTool("set_active_goal", { goal: "Ask user 20 questions about TypeScript" })) as any;
    expect(result.ok).toBe(true);
    expect(result.goal).toBe("Ask user 20 questions about TypeScript");
  });

  test("get_active_goal returns the stored goal after set", async () => {
    await plugin.executeTool("set_active_goal", { goal: "Work through 10 items one at a time" });
    const result = (await plugin.executeTool("get_active_goal", {})) as any;
    expect(result.goal).toBe("Work through 10 items one at a time");
  });

  test("set_active_goal overwrites a previous goal", async () => {
    await plugin.executeTool("set_active_goal", { goal: "First goal" });
    await plugin.executeTool("set_active_goal", { goal: "Updated goal with progress: item 3 of 10" });
    const result = (await plugin.executeTool("get_active_goal", {})) as any;
    expect(result.goal).toBe("Updated goal with progress: item 3 of 10");
  });

  test("clear_active_goal removes the goal", async () => {
    await plugin.executeTool("set_active_goal", { goal: "Some task" });
    const cleared = (await plugin.executeTool("clear_active_goal", {})) as any;
    expect(cleared.ok).toBe(true);
    const result = (await plugin.executeTool("get_active_goal", {})) as any;
    expect(result.goal).toBeNull();
  });

  test("getSystemPromptFragment includes active goal when set", async () => {
    await plugin.executeTool("set_active_goal", { goal: "Ask 20 questions about X" });
    const fragment = plugin.getSystemPromptFragment();
    expect(fragment).toContain("Active Goal");
    expect(fragment).toContain("Ask 20 questions about X");
  });

  test("getSystemPromptFragment omits Active Goal section when no goal is set", async () => {
    const fragment = plugin.getSystemPromptFragment();
    expect(fragment).not.toContain("Active Goal");
  });

  test("getSystemPromptFragment omits Active Goal section after clear", async () => {
    await plugin.executeTool("set_active_goal", { goal: "Some task" });
    await plugin.executeTool("clear_active_goal", {});
    const fragment = plugin.getSystemPromptFragment();
    expect(fragment).not.toContain("Active Goal");
  });
});

// ── unknown tool ──────────────────────────────────────────────────────────────

describe("unknown tool", () => {
  test("returns undefined for unrecognised tool names", async () => {
    const result = await plugin.executeTool("nonexistent_tool", {});
    expect(result).toBeUndefined();
  });
});
