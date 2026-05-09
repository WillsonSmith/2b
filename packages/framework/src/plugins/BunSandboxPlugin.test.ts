import { test, expect, describe, beforeAll } from "bun:test";
import { BunSandboxPlugin } from "./BunSandboxPlugin.ts";

// Minimal stub so onInit doesn't blow up
const fakeAgent = {} as any;

async function execTs(
  plugin: BunSandboxPlugin,
  code: string,
  opts: { input_data?: string; timeout_ms?: number } = {},
) {
  return plugin.executeTool("execute_typescript", { code, ...opts }) as Promise<{
    stdout: string;
    stderr: string;
    exitCode: number | null;
    success: boolean;
    timedOut: boolean;
  }>;
}

// ── runtime detection ──────────────────────────────────────────────────────

describe("runtime detection", () => {
  test("detects apple-container on macOS when `container` binary exists", async () => {
    const proc = Bun.spawn(["which", "container"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    await proc.exited;
    const out = (await new Response(proc.stdout).text()).trim();

    if (process.platform !== "darwin") {
      console.log("SKIP: not macOS");
      return;
    }
    if (out.length === 0) {
      console.log("SKIP: `container` binary not found — apple-container not installed");
      return;
    }
    console.log(`container binary found at: ${out}`);
    expect(out).toBeTruthy();
  });
});

// ── container system ───────────────────────────────────────────────────────

describe("apple container system", () => {
  test("container system start exits cleanly", async () => {
    if (process.platform !== "darwin") {
      console.log("SKIP: not macOS");
      return;
    }
    const proc = Bun.spawn(["which", "container"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    await proc.exited;
    const out = (await new Response(proc.stdout).text()).trim();
    if (!out) {
      console.log("SKIP: `container` binary not found");
      return;
    }

    console.log("Running: container system start");
    const start = Bun.spawn(["container", "system", "start"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await start.exited;
    const stdout = await new Response(start.stdout).text();
    const stderr = await new Response(start.stderr).text();
    console.log("exit code:", exitCode);
    console.log("stdout:", stdout || "(empty)");
    console.log("stderr:", stderr || "(empty)");
    // exit 0 or already running (some runtimes exit non-zero if already up)
    expect([0, 1]).toContain(exitCode);
  }, 30_000);

  test("can pull oven/bun:alpine image", async () => {
    if (process.platform !== "darwin") {
      console.log("SKIP: not macOS");
      return;
    }
    const proc = Bun.spawn(["which", "container"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    await proc.exited;
    const out = (await new Response(proc.stdout).text()).trim();
    if (!out) {
      console.log("SKIP: `container` binary not found");
      return;
    }

    console.log("Running: container image pull oven/bun:alpine");
    const pull = Bun.spawn(["container", "image", "pull", "oven/bun:alpine"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await pull.exited;
    const stdout = await new Response(pull.stdout).text();
    const stderr = await new Response(pull.stderr).text();
    console.log("exit code:", exitCode);
    console.log("stdout:", stdout || "(empty)");
    console.log("stderr:", stderr || "(empty)");
    expect(exitCode).toBe(0);
  }, 120_000);

  test("container run exits cleanly with a simple echo", async () => {
    if (process.platform !== "darwin") {
      console.log("SKIP: not macOS");
      return;
    }
    const proc = Bun.spawn(["which", "container"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    await proc.exited;
    const out = (await new Response(proc.stdout).text()).trim();
    if (!out) {
      console.log("SKIP: `container` binary not found");
      return;
    }

    console.log("Running: container run --rm oven/bun:alpine echo hello");
    const run = Bun.spawn(
      ["container", "run", "--rm", "oven/bun:alpine", "echo", "hello"],
      { stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await run.exited;
    const stdout = await new Response(run.stdout).text();
    const stderr = await new Response(run.stderr).text();
    console.log("exit code:", exitCode);
    console.log("stdout:", stdout || "(empty)");
    console.log("stderr:", stderr || "(empty)");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("hello");
  }, 60_000);
});

// ── plugin integration ─────────────────────────────────────────────────────

describe("BunSandboxPlugin — end to end", () => {
  let plugin: BunSandboxPlugin;

  beforeAll(async () => {
    plugin = new BunSandboxPlugin();
    await plugin.onInit(fakeAgent);
  }, 120_000);

  test("executes simple TypeScript and returns stdout", async () => {
    const result = await execTs(plugin, `console.log("sandbox ok");`);
    console.log("result:", result);
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("sandbox ok");
    expect(result.timedOut).toBe(false);
  }, 60_000);

  test("returns stderr on runtime error", async () => {
    const result = await execTs(plugin, `throw new Error("boom");`);
    console.log("result:", result);
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("boom");
  }, 60_000);

  test("reads INPUT_DATA env var", async () => {
    const result = await execTs(
      plugin,
      `const d = JSON.parse(process.env.INPUT_DATA ?? "null"); console.log(d.msg);`,
      { input_data: JSON.stringify({ msg: "hello from input" }) },
    );
    console.log("result:", result);
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("hello from input");
  }, 60_000);

  test("times out when code exceeds timeout_ms", async () => {
    const result = await execTs(
      plugin,
      `await new Promise(r => setTimeout(r, 60_000));`,
      { timeout_ms: 3_000 },
    );
    console.log("result:", result);
    expect(result.timedOut).toBe(true);
  }, 15_000);

  test("rejects invalid input_data JSON", async () => {
    expect(
      execTs(plugin, `console.log(1);`, { input_data: "not json" }),
    ).rejects.toThrow("input_data must be valid JSON");
  });

  test("rejects empty code", async () => {
    expect(execTs(plugin, "   ")).rejects.toThrow("non-empty string");
  });
});
