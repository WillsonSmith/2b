import { test, expect, describe, beforeAll, afterEach, mock } from "bun:test";
import { DownloadPlugin } from "./DownloadPlugin";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const plugin = new DownloadPlugin();
const downloadsDir = join(process.cwd(), "downloads");

// Ensure downloads/ exists before any tests that write to it.
beforeAll(async () => {
  await mkdir(downloadsDir, { recursive: true });
});

// ── URL validation ───────────────────────────────────────────────────────────

describe("URL validation", () => {
  test("rejects non-HTTPS (http://) URLs", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "http://example.com/file.txt" }),
    ).rejects.toThrow("Only HTTPS URLs are allowed.");
  });

  test("rejects malformed URLs", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "not-a-url" }),
    ).rejects.toThrow();
  });

  test("rejects localhost", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "https://localhost/file.txt" }),
    ).rejects.toThrow("private or internal");
  });

  test("rejects 127.0.0.1", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "https://127.0.0.1/file.txt" }),
    ).rejects.toThrow("private or internal");
  });

  test("rejects ::1 (IPv6 loopback)", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "https://[::1]/file.txt" }),
    ).rejects.toThrow("private or internal");
  });

  test("rejects 10.x.x.x private range", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "https://10.0.0.1/file.txt" }),
    ).rejects.toThrow("private or internal");
  });

  test("rejects 192.168.x.x private range", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "https://192.168.1.100/file.txt" }),
    ).rejects.toThrow("private or internal");
  });

  test("rejects 172.16.x.x–172.31.x.x private range", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "https://172.16.0.1/file.txt" }),
    ).rejects.toThrow("private or internal");
  });

  test("rejects 169.254.x.x link-local range", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "https://169.254.169.254/latest/meta-data/" }),
    ).rejects.toThrow("private or internal");
  });

  test("rejects .internal domains", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "https://service.internal/file.txt" }),
    ).rejects.toThrow("private or internal");
  });

  test("rejects .local domains", async () => {
    await expect(
      plugin.executeTool("download_file", { url: "https://mydevice.local/file.txt" }),
    ).rejects.toThrow("private or internal");
  });

  test("rejects metadata.google.internal", async () => {
    await expect(
      plugin.executeTool("download_file", {
        url: "https://metadata.google.internal/computeMetadata/v1/",
      }),
    ).rejects.toThrow("private or internal");
  });
});

// ── Download behaviour (fetch mocked) ────────────────────────────────────────

describe("download behaviour", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("downloads a file and returns path, size, and contentType", async () => {
    const body = "file content here";
    globalThis.fetch = mock(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    ) as unknown as typeof fetch;

    const result = (await plugin.executeTool("download_file", {
      url: "https://example.com/test.txt",
    })) as any;

    expect(result.contentType).toBe("text/plain");
    expect(result.size).toBe(body.length);
    expect(result.path).toContain("test.txt");

    await rm(result.path, { force: true });
  });

  test("uses the custom destination filename when provided", async () => {
    globalThis.fetch = mock(async () =>
      new Response("data", {
        status: 200,
        headers: { "content-type": "application/octet-stream" },
      }),
    ) as unknown as typeof fetch;

    const result = (await plugin.executeTool("download_file", {
      url: "https://example.com/original.bin",
      destination: "renamed.bin",
    })) as any;

    expect(result.path).toContain("renamed.bin");

    await rm(result.path, { force: true });
  });

  test("falls back to 'download' when the URL has no filename", async () => {
    globalThis.fetch = mock(async () =>
      new Response("x", { status: 200, headers: { "content-type": "text/plain" } }),
    ) as unknown as typeof fetch;

    const result = (await plugin.executeTool("download_file", {
      url: "https://example.com/",
    })) as any;

    expect(result.path).toContain("download");

    await rm(result.path, { force: true });
  });

  test("rejects when the server returns a 4xx/5xx status", async () => {
    globalThis.fetch = mock(async () => new Response("Not Found", { status: 404 })) as unknown as typeof fetch;

    await expect(
      plugin.executeTool("download_file", { url: "https://example.com/missing.txt" }),
    ).rejects.toThrow("server returned 404");
  });

  test("rejects when content-length header exceeds 100 MB", async () => {
    const overLimit = (100 * 1024 * 1024 + 1).toString();
    globalThis.fetch = mock(async () =>
      new Response("x", {
        status: 200,
        headers: { "content-length": overLimit },
      }),
    ) as unknown as typeof fetch;

    await expect(
      plugin.executeTool("download_file", { url: "https://example.com/huge.bin" }),
    ).rejects.toThrow("100 MB");
  });

  test("accepts files exactly at the content-length limit edge", async () => {
    const atLimit = (100 * 1024 * 1024).toString();
    const body = "x";
    globalThis.fetch = mock(async () =>
      new Response(body, {
        status: 200,
        headers: { "content-length": atLimit, "content-type": "text/plain" },
      }),
    ) as unknown as typeof fetch;

    // Does not throw — content-length is not strictly greater than the limit
    const result = (await plugin.executeTool("download_file", {
      url: "https://example.com/edge.txt",
    })) as any;

    expect(result.path).toContain("edge.txt");

    await rm(result.path, { force: true });
  });
});

// ── unknown tools ────────────────────────────────────────────────────────────

describe("unknown tool", () => {
  test("returns undefined for unrecognised tool names", async () => {
    const result = await plugin.executeTool("other_tool", {});
    expect(result).toBeUndefined();
  });
});
