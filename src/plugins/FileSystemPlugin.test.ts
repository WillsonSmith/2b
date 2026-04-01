import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { FileSystemPlugin } from "./FileSystemPlugin";
import { join, relative } from "node:path";
import {
  mkdtemp,
  rm,
  writeFile as nodeWriteFile,
  mkdir as nodeMkdir,
} from "node:fs/promises";

const plugin = new FileSystemPlugin();
const cwd = process.cwd();

let tmpDir: string;

// r() converts an absolute path under tmpDir to a cwd-relative path
// that validatePath will accept.
function r(absPath: string): string {
  return relative(cwd, absPath);
}

beforeEach(async () => {
  tmpDir = await mkdtemp(join(cwd, "test-fs-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ── read_file ────────────────────────────────────────────────────────────────

describe("read_file", () => {
  test("reads the full content of a file", async () => {
    await nodeWriteFile(join(tmpDir, "hello.txt"), "hello world");
    const result = (await plugin.executeTool("read_file", {
      path: r(join(tmpDir, "hello.txt")),
    })) as any;
    expect(result.content).toBe("hello world");
    expect(result.size).toBe(11);
    expect(result.totalLines).toBe(1);
    expect(result.returnedLines).toBe(1);
  });

  test("respects offset (1-indexed) and limit", async () => {
    await nodeWriteFile(join(tmpDir, "lines.txt"), "a\nb\nc\nd\ne");
    const result = (await plugin.executeTool("read_file", {
      path: r(join(tmpDir, "lines.txt")),
      offset: 2,
      limit: 2,
    })) as any;
    expect(result.content).toBe("b\nc");
    expect(result.returnedLines).toBe(2);
  });

  test("offset 1 returns from the first line", async () => {
    await nodeWriteFile(join(tmpDir, "lines.txt"), "x\ny\nz");
    const result = (await plugin.executeTool("read_file", {
      path: r(join(tmpDir, "lines.txt")),
      offset: 1,
    })) as any;
    expect(result.content).toBe("x\ny\nz");
  });

  test("limit without offset returns first N lines", async () => {
    await nodeWriteFile(join(tmpDir, "lines.txt"), "1\n2\n3\n4\n5");
    const result = (await plugin.executeTool("read_file", {
      path: r(join(tmpDir, "lines.txt")),
      limit: 3,
    })) as any;
    expect(result.content).toBe("1\n2\n3");
    expect(result.returnedLines).toBe(3);
    expect(result.totalLines).toBe(5);
  });

  test("returns totalLines correctly for multi-line files", async () => {
    await nodeWriteFile(join(tmpDir, "multi.txt"), "a\nb\nc");
    const result = (await plugin.executeTool("read_file", {
      path: r(join(tmpDir, "multi.txt")),
    })) as any;
    expect(result.totalLines).toBe(3);
  });

  test("rejects path traversal outside working directory", async () => {
    await expect(
      plugin.executeTool("read_file", { path: "../../etc/passwd" }),
    ).rejects.toThrow("Path must be within the working directory.");
  });

  test("rejects absolute paths outside working directory", async () => {
    await expect(
      plugin.executeTool("read_file", { path: "/etc/hosts" }),
    ).rejects.toThrow("Path must be within the working directory.");
  });
});

// ── write_file ───────────────────────────────────────────────────────────────

describe("write_file", () => {
  test("creates a new file with the given content", async () => {
    const filePath = r(join(tmpDir, "new.txt"));
    await plugin.executeTool("write_file", { path: filePath, content: "created" });
    expect(await Bun.file(join(cwd, filePath)).text()).toBe("created");
  });

  test("overwrites an existing file", async () => {
    const abs = join(tmpDir, "existing.txt");
    await nodeWriteFile(abs, "original");
    await plugin.executeTool("write_file", { path: r(abs), content: "overwritten" });
    expect(await Bun.file(abs).text()).toBe("overwritten");
  });

  test("creates missing parent directories", async () => {
    const filePath = r(join(tmpDir, "a", "b", "c", "deep.txt"));
    await plugin.executeTool("write_file", { path: filePath, content: "deep" });
    expect(await Bun.file(join(cwd, filePath)).text()).toBe("deep");
  });

  test("returns the resolved path and byte count", async () => {
    const result = (await plugin.executeTool("write_file", {
      path: r(join(tmpDir, "out.txt")),
      content: "hello",
    })) as any;
    expect(result.size).toBe(5);
    expect(typeof result.path).toBe("string");
  });

  test("rejects path traversal", async () => {
    await expect(
      plugin.executeTool("write_file", { path: "../../outside.txt", content: "x" }),
    ).rejects.toThrow("Path must be within the working directory.");
  });
});

// ── append_file ──────────────────────────────────────────────────────────────

describe("append_file", () => {
  test("appends content to an existing file", async () => {
    const abs = join(tmpDir, "append.txt");
    await nodeWriteFile(abs, "first");
    await plugin.executeTool("append_file", { path: r(abs), content: " second" });
    expect(await Bun.file(abs).text()).toBe("first second");
  });

  test("creates the file if it does not exist", async () => {
    const filePath = r(join(tmpDir, "new-append.txt"));
    await plugin.executeTool("append_file", { path: filePath, content: "created" });
    expect(await Bun.file(join(cwd, filePath)).text()).toBe("created");
  });

  test("can append multiple times", async () => {
    const abs = join(tmpDir, "multi.txt");
    await plugin.executeTool("append_file", { path: r(abs), content: "a" });
    await plugin.executeTool("append_file", { path: r(abs), content: "b" });
    await plugin.executeTool("append_file", { path: r(abs), content: "c" });
    expect(await Bun.file(abs).text()).toBe("abc");
  });
});

// ── list_directory ───────────────────────────────────────────────────────────

describe("list_directory", () => {
  test("lists files and subdirectories", async () => {
    await nodeWriteFile(join(tmpDir, "file.txt"), "x");
    await nodeMkdir(join(tmpDir, "subdir"));
    const result = (await plugin.executeTool("list_directory", { path: r(tmpDir) })) as any;
    const names = result.entries.map((e: any) => e.name);
    expect(names).toContain("file.txt");
    expect(names).toContain("subdir");
  });

  test("reports correct types for files and directories", async () => {
    await nodeWriteFile(join(tmpDir, "f.txt"), "x");
    await nodeMkdir(join(tmpDir, "d"));
    const result = (await plugin.executeTool("list_directory", { path: r(tmpDir) })) as any;
    const file = result.entries.find((e: any) => e.name === "f.txt");
    const dir = result.entries.find((e: any) => e.name === "d");
    expect(file.type).toBe("file");
    expect(dir.type).toBe("directory");
  });

  test("includes size for files", async () => {
    await nodeWriteFile(join(tmpDir, "sized.txt"), "12345");
    const result = (await plugin.executeTool("list_directory", { path: r(tmpDir) })) as any;
    const file = result.entries.find((e: any) => e.name === "sized.txt");
    expect(file.size).toBe(5);
  });

  test("returns empty entries for empty directory", async () => {
    const emptyDir = join(tmpDir, "empty");
    await nodeMkdir(emptyDir);
    const result = (await plugin.executeTool("list_directory", { path: r(emptyDir) })) as any;
    expect(result.entries).toEqual([]);
  });
});

// ── move_file ────────────────────────────────────────────────────────────────

describe("move_file", () => {
  test("renames a file within the same directory", async () => {
    const src = join(tmpDir, "old.txt");
    const dst = join(tmpDir, "new.txt");
    await nodeWriteFile(src, "content");
    await plugin.executeTool("move_file", { source: r(src), destination: r(dst) });
    expect(await Bun.file(src).exists()).toBe(false);
    expect(await Bun.file(dst).text()).toBe("content");
  });

  test("moves a file to a subdirectory, creating it as needed", async () => {
    const src = join(tmpDir, "file.txt");
    const dst = join(tmpDir, "sub", "file.txt");
    await nodeWriteFile(src, "moved");
    await plugin.executeTool("move_file", { source: r(src), destination: r(dst) });
    expect(await Bun.file(dst).text()).toBe("moved");
  });

  test("returns from and to paths", async () => {
    const src = join(tmpDir, "a.txt");
    const dst = join(tmpDir, "b.txt");
    await nodeWriteFile(src, "x");
    const result = (await plugin.executeTool("move_file", {
      source: r(src),
      destination: r(dst),
    })) as any;
    expect(typeof result.from).toBe("string");
    expect(typeof result.to).toBe("string");
  });
});

// ── copy_file ────────────────────────────────────────────────────────────────

describe("copy_file", () => {
  test("copies a file, leaving the original in place", async () => {
    const src = join(tmpDir, "original.txt");
    const dst = join(tmpDir, "copy.txt");
    await nodeWriteFile(src, "data");
    await plugin.executeTool("copy_file", { source: r(src), destination: r(dst) });
    expect(await Bun.file(src).text()).toBe("data");
    expect(await Bun.file(dst).text()).toBe("data");
  });

  test("creates missing parent directories at destination", async () => {
    const src = join(tmpDir, "file.txt");
    const dst = join(tmpDir, "nested", "deep", "copy.txt");
    await nodeWriteFile(src, "data");
    await plugin.executeTool("copy_file", { source: r(src), destination: r(dst) });
    expect(await Bun.file(dst).text()).toBe("data");
  });
});

// ── delete_file ──────────────────────────────────────────────────────────────

describe("delete_file", () => {
  test("deletes a file", async () => {
    const abs = join(tmpDir, "delete-me.txt");
    await nodeWriteFile(abs, "bye");
    await plugin.executeTool("delete_file", { path: r(abs) });
    expect(await Bun.file(abs).exists()).toBe(false);
  });

  test("throws when the file does not exist", async () => {
    await expect(
      plugin.executeTool("delete_file", { path: r(join(tmpDir, "ghost.txt")) }),
    ).rejects.toThrow();
  });
});

// ── make_directory ───────────────────────────────────────────────────────────

describe("make_directory", () => {
  test("creates a directory", async () => {
    const dirPath = r(join(tmpDir, "new-dir"));
    await plugin.executeTool("make_directory", { path: dirPath });
    const result = (await plugin.executeTool("list_directory", { path: dirPath })) as any;
    expect(result.entries).toEqual([]);
  });

  test("creates nested directories recursively", async () => {
    const dirPath = r(join(tmpDir, "a", "b", "c"));
    await plugin.executeTool("make_directory", { path: dirPath });
    const result = (await plugin.executeTool("list_directory", { path: dirPath })) as any;
    expect(result.entries).toEqual([]);
  });

  test("does not throw if the directory already exists", async () => {
    await expect(
      plugin.executeTool("make_directory", { path: r(tmpDir) }),
    ).resolves.toBeDefined();
  });
});

// ── stat_file ────────────────────────────────────────────────────────────────

describe("stat_file", () => {
  test("returns file type, size, and modifiedAt for a file", async () => {
    const abs = join(tmpDir, "stat-me.txt");
    await nodeWriteFile(abs, "12345");
    const result = (await plugin.executeTool("stat_file", { path: r(abs) })) as any;
    expect(result.type).toBe("file");
    expect(result.size).toBe(5);
    expect(typeof result.modifiedAt).toBe("string");
    expect(new Date(result.modifiedAt).getFullYear()).toBeGreaterThan(2020);
  });

  test("returns directory type for a directory", async () => {
    const result = (await plugin.executeTool("stat_file", { path: r(tmpDir) })) as any;
    expect(result.type).toBe("directory");
  });

  test("throws when the path does not exist", async () => {
    await expect(
      plugin.executeTool("stat_file", { path: r(join(tmpDir, "ghost.txt")) }),
    ).rejects.toThrow();
  });
});

// ── find_files ───────────────────────────────────────────────────────────────

describe("find_files", () => {
  test("finds files matching a pattern", async () => {
    await nodeWriteFile(join(tmpDir, "a.ts"), "");
    await nodeWriteFile(join(tmpDir, "b.ts"), "");
    await nodeWriteFile(join(tmpDir, "c.txt"), "");
    const result = (await plugin.executeTool("find_files", {
      pattern: `${r(tmpDir)}/*.ts`,
    })) as any;
    const names = result.matches.map((m: string) => m.split("/").pop());
    expect(names).toContain("a.ts");
    expect(names).toContain("b.ts");
    expect(names).not.toContain("c.txt");
  });

  test("matches files recursively with ** pattern", async () => {
    await nodeMkdir(join(tmpDir, "sub"));
    await nodeWriteFile(join(tmpDir, "sub", "nested.ts"), "");
    const result = (await plugin.executeTool("find_files", {
      pattern: `${r(tmpDir)}/**/*.ts`,
    })) as any;
    const names = result.matches.map((m: string) => m.split("/").pop());
    expect(names).toContain("nested.ts");
  });

  test("returns empty array when no files match", async () => {
    const result = (await plugin.executeTool("find_files", {
      pattern: `${r(tmpDir)}/*.xyz`,
    })) as any;
    expect(result.matches).toEqual([]);
  });

  test("returns the original pattern in the result", async () => {
    const pattern = `${r(tmpDir)}/*.md`;
    const result = (await plugin.executeTool("find_files", { pattern })) as any;
    expect(result.pattern).toBe(pattern);
  });
});

// ── unknown tools ────────────────────────────────────────────────────────────

describe("unknown tool", () => {
  test("returns undefined for unrecognised tool names", async () => {
    const result = await plugin.executeTool("nonexistent_tool", {});
    expect(result).toBeUndefined();
  });
});

// ── error wrapping ────────────────────────────────────────────────────────────

describe("error wrapping", () => {
  test("prefixes errors with the tool name", async () => {
    await expect(
      plugin.executeTool("stat_file", { path: r(join(tmpDir, "ghost.txt")) }),
    ).rejects.toThrow("stat_file failed:");
  });

  test("rejects paginated reads of files over 10 MB", async () => {
    const abs = join(tmpDir, "big.bin");
    await nodeWriteFile(abs, Buffer.alloc(10 * 1024 * 1024 + 1, "x"));
    await expect(
      plugin.executeTool("read_file", { path: r(abs), offset: 1, limit: 10 }),
    ).rejects.toThrow("exceeds the 10 MB read limit");
  });
});
