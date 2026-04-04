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
    ).rejects.toThrow("Path must be within an allowed root.");
  });

  test("rejects absolute paths outside working directory", async () => {
    await expect(
      plugin.executeTool("read_file", { path: "/etc/hosts" }),
    ).rejects.toThrow("Path must be within an allowed root.");
  });

  test("does not inflate totalLines for files ending with a newline", async () => {
    await nodeWriteFile(join(tmpDir, "trailing.txt"), "a\nb\nc\n");
    const result = (await plugin.executeTool("read_file", {
      path: r(join(tmpDir, "trailing.txt")),
    })) as any;
    expect(result.totalLines).toBe(3);
    expect(result.content).toBe("a\nb\nc");
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
    ).rejects.toThrow("Path must be within an allowed root.");
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
    expect(result.matches.every((m: string) => m.startsWith("/"))).toBe(true);
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

// ── delete_directory ─────────────────────────────────────────────────────────

describe("delete_directory", () => {
  test("deletes a directory and its contents recursively", async () => {
    const subdir = join(tmpDir, "to-delete");
    await nodeMkdir(subdir);
    await nodeWriteFile(join(subdir, "file.txt"), "data");
    await plugin.executeTool("delete_directory", { path: r(subdir) });
    expect(await Bun.file(subdir).exists()).toBe(false);
  });

  test("rejects deleting an allowed root", async () => {
    await expect(
      plugin.executeTool("delete_directory", { path: "." }),
    ).rejects.toThrow("Cannot delete an allowed root");
  });

  test("rejects deleting a path that is a file, not a directory", async () => {
    const abs = join(tmpDir, "notadir.txt");
    await nodeWriteFile(abs, "x");
    await expect(
      plugin.executeTool("delete_directory", { path: r(abs) }),
    ).rejects.toThrow("Not a directory");
  });
});

// ── search_in_files ───────────────────────────────────────────────────────────

describe("search_in_files", () => {
  test("finds a pattern in matching files", async () => {
    await nodeWriteFile(join(tmpDir, "a.txt"), "hello world\nfoo bar");
    const result = (await plugin.executeTool("search_in_files", {
      pattern: "hello",
      cwd: tmpDir,
    })) as any;
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0].line).toBe(1);
    expect(result.matches[0].content).toContain("hello");
    expect(result.matches[0].file.startsWith("/")).toBe(true);
  });

  test("returns no matches when pattern is absent", async () => {
    await nodeWriteFile(join(tmpDir, "b.txt"), "nothing relevant here");
    const result = (await plugin.executeTool("search_in_files", {
      pattern: "zzznomatch",
      cwd: tmpDir,
    })) as any;
    expect(result.matches).toEqual([]);
  });

  test("respects the glob filter", async () => {
    await nodeWriteFile(join(tmpDir, "code.ts"), "const needle = 1;");
    await nodeWriteFile(join(tmpDir, "prose.txt"), "needle in a haystack");
    const result = (await plugin.executeTool("search_in_files", {
      pattern: "needle",
      glob: "**/*.ts",
      cwd: tmpDir,
    })) as any;
    const files = result.matches.map((m: any) => m.file as string);
    expect(files.some((f: string) => f.endsWith(".ts"))).toBe(true);
    expect(files.some((f: string) => f.endsWith(".txt"))).toBe(false);
  });

  test("respects caseSensitive: false", async () => {
    await nodeWriteFile(join(tmpDir, "c.txt"), "Hello World");
    const result = (await plugin.executeTool("search_in_files", {
      pattern: "hello",
      caseSensitive: false,
      cwd: tmpDir,
    })) as any;
    expect(result.matches.length).toBeGreaterThan(0);
  });
});

// ── allowedRoots ──────────────────────────────────────────────────────────────

describe("allowedRoots", () => {
  let tmpDir2: string;

  beforeEach(async () => {
    tmpDir2 = await mkdtemp(join(cwd, "test-fs2-"));
  });

  afterEach(async () => {
    await rm(tmpDir2, { recursive: true, force: true });
  });

  test("can access a file in a second allowed root using its absolute path", async () => {
    const multiPlugin = new FileSystemPlugin({ allowedRoots: [tmpDir, tmpDir2] });
    await nodeWriteFile(join(tmpDir2, "remote.txt"), "from root2");
    const result = (await multiPlugin.executeTool("read_file", {
      path: join(tmpDir2, "remote.txt"),
    })) as any;
    expect(result.content).toBe("from root2");
  });

  test("rejects a path outside all allowed roots", async () => {
    const multiPlugin = new FileSystemPlugin({ allowedRoots: [tmpDir, tmpDir2] });
    await expect(
      multiPlugin.executeTool("read_file", { path: "/etc/hosts" }),
    ).rejects.toThrow("Path must be within an allowed root.");
  });
});

// ── patch_file ───────────────────────────────────────────────────────────────

describe("patch_file", () => {
  test("applies a single search/replace edit", async () => {
    const abs = join(tmpDir, "patch.ts");
    await nodeWriteFile(abs, "function foo() {\n  return 1;\n}\n");
    await plugin.executeTool("patch_file", {
      path: r(abs),
      edits: [{ search: "return 1;", replace: "return 2;" }],
    });
    expect(await Bun.file(abs).text()).toBe("function foo() {\n  return 2;\n}\n");
  });

  test("applies multiple non-overlapping edits atomically", async () => {
    const abs = join(tmpDir, "multi.ts");
    await nodeWriteFile(abs, "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    await plugin.executeTool("patch_file", {
      path: r(abs),
      edits: [
        { search: "const a = 1;", replace: "const a = 10;" },
        { search: "const c = 3;", replace: "const c = 30;" },
      ],
    });
    expect(await Bun.file(abs).text()).toBe("const a = 10;\nconst b = 2;\nconst c = 30;\n");
  });

  test("returns editsApplied, linesAdded, and linesRemoved", async () => {
    const abs = join(tmpDir, "stats.ts");
    await nodeWriteFile(abs, "line1\nline2\nline3\n");
    const result = (await plugin.executeTool("patch_file", {
      path: r(abs),
      edits: [{ search: "line2", replace: "replaced2\nextra" }],
    })) as any;
    expect(result.editsApplied).toBe(1);
    expect(result.linesAdded).toBe(2);
    expect(result.linesRemoved).toBe(1);
  });

  test("falls back to whitespace-normalized match when indentation differs", async () => {
    const abs = join(tmpDir, "indent.ts");
    await nodeWriteFile(abs, "function foo() {\n  return 1;\n}\n");
    // Search with no leading whitespace — should still match
    await plugin.executeTool("patch_file", {
      path: r(abs),
      edits: [{ search: "function foo() {\nreturn 1;\n}", replace: "function foo() {\n  return 99;\n}" }],
    });
    expect(await Bun.file(abs).text()).toContain("return 99;");
  });

  test("throws when search string is not found", async () => {
    const abs = join(tmpDir, "notfound.ts");
    await nodeWriteFile(abs, "hello world");
    await expect(
      plugin.executeTool("patch_file", {
        path: r(abs),
        edits: [{ search: "missing text", replace: "x" }],
      }),
    ).rejects.toThrow("Search string not found");
  });

  test("throws when search string matches multiple locations", async () => {
    const abs = join(tmpDir, "ambiguous.ts");
    await nodeWriteFile(abs, "foo\nfoo\n");
    await expect(
      plugin.executeTool("patch_file", {
        path: r(abs),
        edits: [{ search: "foo", replace: "bar" }],
      }),
    ).rejects.toThrow("matches multiple locations");
  });

  test("throws when edits overlap", async () => {
    const abs = join(tmpDir, "overlap.ts");
    await nodeWriteFile(abs, "abcdef");
    await expect(
      plugin.executeTool("patch_file", {
        path: r(abs),
        edits: [
          { search: "abcd", replace: "ABCD" },
          { search: "cdef", replace: "CDEF" },
        ],
      }),
    ).rejects.toThrow("overlap");
  });

  test("throws when search is empty", async () => {
    const abs = join(tmpDir, "empty-search.ts");
    await nodeWriteFile(abs, "content");
    await expect(
      plugin.executeTool("patch_file", {
        path: r(abs),
        edits: [{ search: "", replace: "x" }],
      }),
    ).rejects.toThrow("must not be empty");
  });

  test("throws when file does not exist", async () => {
    await expect(
      plugin.executeTool("patch_file", {
        path: r(join(tmpDir, "ghost.ts")),
        edits: [{ search: "x", replace: "y" }],
      }),
    ).rejects.toThrow("File not found");
  });

  test("rejects binary files", async () => {
    const abs = join(tmpDir, "bin.dat");
    const buf = Buffer.alloc(64, 0x00);
    await nodeWriteFile(abs, buf);
    await expect(
      plugin.executeTool("patch_file", {
        path: r(abs),
        edits: [{ search: "x", replace: "y" }],
      }),
    ).rejects.toThrow("binary");
  });

  test("does not modify the file if any edit fails validation", async () => {
    const abs = join(tmpDir, "atomic.ts");
    const original = "const x = 1;\nconst y = 2;\n";
    await nodeWriteFile(abs, original);
    await expect(
      plugin.executeTool("patch_file", {
        path: r(abs),
        edits: [
          { search: "const x = 1;", replace: "const x = 99;" },
          { search: "does not exist", replace: "anything" },
        ],
      }),
    ).rejects.toThrow();
    // File should be unchanged
    expect(await Bun.file(abs).text()).toBe(original);
  });
});

// ── patch_file_range ──────────────────────────────────────────────────────────

describe("patch_file_range", () => {
  test("replaces a single line in the middle of a file", async () => {
    const abs = join(tmpDir, "range.ts");
    await nodeWriteFile(abs, "a\nb\nc\nd\ne\n");
    await plugin.executeTool("patch_file_range", {
      path: r(abs),
      startLine: 3,
      endLine: 3,
      newContent: "C",
    });
    expect(await Bun.file(abs).text()).toBe("a\nb\nC\nd\ne\n");
  });

  test("replaces multiple lines with more lines", async () => {
    const abs = join(tmpDir, "multi.ts");
    await nodeWriteFile(abs, "a\nb\nc\nd\ne\n");
    await plugin.executeTool("patch_file_range", {
      path: r(abs),
      startLine: 2,
      endLine: 4,
      newContent: "X\nY\nZ\nW",
    });
    expect(await Bun.file(abs).text()).toBe("a\nX\nY\nZ\nW\ne\n");
  });

  test("replaces multiple lines with fewer lines", async () => {
    const abs = join(tmpDir, "shrink.ts");
    await nodeWriteFile(abs, "a\nb\nc\nd\ne\n");
    await plugin.executeTool("patch_file_range", {
      path: r(abs),
      startLine: 2,
      endLine: 4,
      newContent: "X",
    });
    expect(await Bun.file(abs).text()).toBe("a\nX\ne\n");
  });

  test("deletes lines when newContent is empty string", async () => {
    const abs = join(tmpDir, "delete.ts");
    await nodeWriteFile(abs, "a\nb\nc\nd\ne\n");
    await plugin.executeTool("patch_file_range", {
      path: r(abs),
      startLine: 2,
      endLine: 4,
      newContent: "",
    });
    expect(await Bun.file(abs).text()).toBe("a\ne\n");
  });

  test("replaces last line in a file without trailing newline", async () => {
    const abs = join(tmpDir, "no-trailing.ts");
    await nodeWriteFile(abs, "a\nb\nc");
    await plugin.executeTool("patch_file_range", {
      path: r(abs),
      startLine: 3,
      endLine: 3,
      newContent: "C",
    });
    expect(await Bun.file(abs).text()).toBe("a\nb\nC");
  });

  test("replaces first line", async () => {
    const abs = join(tmpDir, "first.ts");
    await nodeWriteFile(abs, "a\nb\nc\n");
    await plugin.executeTool("patch_file_range", {
      path: r(abs),
      startLine: 1,
      endLine: 1,
      newContent: "A",
    });
    expect(await Bun.file(abs).text()).toBe("A\nb\nc\n");
  });

  test("returns correct linesRemoved and linesAdded", async () => {
    const abs = join(tmpDir, "stats.ts");
    await nodeWriteFile(abs, "a\nb\nc\nd\ne\n");
    const result = (await plugin.executeTool("patch_file_range", {
      path: r(abs),
      startLine: 2,
      endLine: 4,
      newContent: "X\nY",
    })) as any;
    expect(result.linesRemoved).toBe(3);
    expect(result.linesAdded).toBe(2);
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(4);
  });

  test("throws when startLine exceeds file length", async () => {
    const abs = join(tmpDir, "short.ts");
    await nodeWriteFile(abs, "a\nb\n");
    await expect(
      plugin.executeTool("patch_file_range", {
        path: r(abs),
        startLine: 10,
        endLine: 10,
        newContent: "x",
      }),
    ).rejects.toThrow("exceeds the file's line count");
  });

  test("throws when endLine < startLine", async () => {
    const abs = join(tmpDir, "bad-range.ts");
    await nodeWriteFile(abs, "a\nb\nc\n");
    await expect(
      plugin.executeTool("patch_file_range", {
        path: r(abs),
        startLine: 3,
        endLine: 1,
        newContent: "x",
      }),
    ).rejects.toThrow("endLine");
  });

  test("throws when file does not exist", async () => {
    await expect(
      plugin.executeTool("patch_file_range", {
        path: r(join(tmpDir, "ghost.ts")),
        startLine: 1,
        endLine: 1,
        newContent: "x",
      }),
    ).rejects.toThrow("File not found");
  });

  test("cleans up temp file when an error occurs", async () => {
    const abs = join(tmpDir, "cleanup.ts");
    await nodeWriteFile(abs, "a\nb\n");
    await expect(
      plugin.executeTool("patch_file_range", {
        path: r(abs),
        startLine: 99,
        endLine: 99,
        newContent: "x",
      }),
    ).rejects.toThrow();
    const tmpExists = await Bun.file(abs + ".__patch_tmp__").exists();
    expect(tmpExists).toBe(false);
  });
});

// ── patch_file: MAX_PATCH_BYTES guard ─────────────────────────────────────────

describe("patch_file size guard", () => {
  test("rejects files over 10 MB with a helpful message", async () => {
    const abs = join(tmpDir, "big.txt");
    await nodeWriteFile(abs, Buffer.alloc(10 * 1024 * 1024 + 1, 0x61)); // 'a' * 10MB+1
    await expect(
      plugin.executeTool("patch_file", {
        path: r(abs),
        edits: [{ search: "a", replace: "b" }],
      }),
    ).rejects.toThrow("patch_file_range");
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
