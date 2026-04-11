import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import { logger } from "../logger.ts";

const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 256 * 1024; // 64 KB
const MAX_CODE_BYTES = 256 * 1024; // 256 KB
const MAX_INPUT_BYTES = 256 * 1024; // 256 KB
const CONTAINER_IMAGE = "oven/bun:alpine";

type ContainerRuntime = "docker" | "apple-container";

async function detectRuntime(): Promise<ContainerRuntime> {
  if (process.platform !== "darwin") return "docker";
  const proc = Bun.spawn(["which", "container"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  await proc.exited;
  const out = await new Response(proc.stdout).text();
  return out.trim().length > 0 ? "apple-container" : "docker";
}

export class BunSandboxPlugin implements AgentPlugin {
  name = "BunSandbox";
  private runtime: ContainerRuntime = "docker";
  private initPromise: Promise<void> | null = null;

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch((err) => {
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    this.runtime = await detectRuntime();
    logger.info("BunSandbox", `Runtime: ${this.runtime}`);

    if (this.runtime === "apple-container") {
      logger.info("BunSandbox", "Starting container system...");
      const startProc = Bun.spawn(["container", "system", "start"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await startProc.exited;
      logger.info("BunSandbox", "Container system ready");
    }

    const pullCmd =
      this.runtime === "apple-container"
        ? ["container", "pull", CONTAINER_IMAGE]
        : ["docker", "pull", CONTAINER_IMAGE];

    logger.info("BunSandbox", `Pre-pulling ${CONTAINER_IMAGE}...`);
    await Bun.spawn(pullCmd, { stdout: "ignore", stderr: "ignore" })
      .exited.then(() => logger.info("BunSandbox", `${CONTAINER_IMAGE} ready`))
      .catch(() =>
        logger.info("BunSandbox", `Pre-pull failed — will pull on first run`),
      );
  }

  async onInit(_agent: BaseAgent): Promise<void> {
    await this.ensureInitialized();
  }

  getSystemPromptFragment(): string {
    return [
      "You have access to a TypeScript/Bun code execution sandbox running in an isolated container.",
      "Use execute_typescript to run TypeScript code directly — you write the code yourself.",
      "The code runs with Bun, so you can use Bun APIs (Bun.file, bun:sqlite, etc.) and any built-in Bun modules.",
      "No npm packages are available — use only built-in Bun/Node APIs and the TypeScript standard library.",
      "Pass structured input via 'input_data' (a JSON string); read it with:",
      "const data = JSON.parse(process.env.INPUT_DATA ?? 'null');",
      "Use console.log() to output results. No network access. No host filesystem access.",
    ].join(" ");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "execute_typescript",
        description:
          "Execute TypeScript code in an isolated Bun container. " +
          "You write the code directly — no code generation model is involved. " +
          "Bun APIs and built-in Node modules are available. No npm packages. No network. No host filesystem. " +
          "Returns { stdout, stderr, exitCode, success, timedOut }.",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description:
                "TypeScript source code to execute. " +
                "Use console.log() for output. " +
                "Read input with: const data = JSON.parse(process.env.INPUT_DATA ?? 'null');",
            },
            input_data: {
              type: "string",
              description:
                "Optional JSON string passed to the code via INPUT_DATA env var.",
            },
            timeout_ms: {
              type: "number",
              description: `Execution timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
            },
          },
          required: ["code"],
        },
      },
    ];
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (name !== "execute_typescript") return undefined;

    await this.ensureInitialized();

    const { code, input_data, timeout_ms } = args as {
      code: string;
      input_data?: string;
      timeout_ms?: number;
    };

    if (typeof code !== "string" || code.trim().length === 0)
      throw new Error("code must be a non-empty string");

    const codeBytes = Buffer.byteLength(code);
    if (codeBytes > MAX_CODE_BYTES)
      throw new Error(`code exceeds maximum size of ${MAX_CODE_BYTES} bytes`);

    if (input_data !== undefined && input_data !== null) {
      if (Buffer.byteLength(input_data) > MAX_INPUT_BYTES)
        throw new Error(
          `input_data exceeds maximum size of ${MAX_INPUT_BYTES} bytes`,
        );
      try {
        JSON.parse(input_data);
      } catch {
        throw new Error("input_data must be valid JSON");
      }
    }

    const timeout = Math.min(
      typeof timeout_ms === "number" && timeout_ms > 0
        ? timeout_ms
        : DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );

    const runArgs = this.buildRunArgs(input_data);
    // Write code to /tmp/script.ts then execute it — avoids shell escaping and
    // handles TypeScript syntax correctly (bun infers .ts from extension).
    runArgs.push(
      CONTAINER_IMAGE,
      "sh",
      "-c",
      "cat > /tmp/script.ts && bun /tmp/script.ts",
    );

    logger.info(
      "BunSandbox",
      `Launching container (timeout: ${timeout}ms, ${codeBytes} bytes)`,
    );

    const proc = Bun.spawn(runArgs, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Write code to container stdin, then close so `cat` terminates.
    proc.stdin.write(code);
    proc.stdin.end();

    // Begin buffering stdout/stderr immediately — before awaiting exited — so
    // we don't race against Bun closing the streams after the process exits.
    const stdoutPromise = new Response(proc.stdout).text();
    const stderrPromise = new Response(proc.stderr).text();

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutRace = new Promise<"timeout">((resolve) => {
      timeoutHandle = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve("timeout");
      }, timeout);
    });

    const result = await Promise.race([proc.exited, timeoutRace]);
    clearTimeout(timeoutHandle);
    const timedOut = result === "timeout";
    const exitCode = timedOut ? null : (result as number);

    const [stdoutRaw, stderrRaw] = await Promise.all([
      stdoutPromise,
      stderrPromise,
    ]);

    logger.info(
      "BunSandbox",
      `Container finished — exit ${exitCode ?? "killed"}${timedOut ? " (timed out)" : ""}`,
    );

    return {
      stdout: truncate(stdoutRaw, MAX_OUTPUT_BYTES),
      stderr: truncate(stderrRaw, MAX_OUTPUT_BYTES),
      exitCode,
      success: exitCode === 0,
      timedOut,
    };
  }

  private buildRunArgs(input_data?: string | null): string[] {
    if (this.runtime === "apple-container") {
      const args = [
        "container",
        "run",
        "--rm",
        "--no-dns",
        "--memory",
        "512M",
        "--cpus",
        "1.0",
        "--ulimit",
        "nproc=128:128",
        "--uid",
        "65534",
        "--read-only",
        "--tmpfs",
        "/tmp",
      ];
      if (input_data != null) args.push("-e", `INPUT_DATA=${input_data}`);
      return args;
    }

    const args = [
      "docker",
      "run",
      "--rm",
      "--network=none",
      "--memory=512m",
      "--cpus=1.0",
      "--pids-limit=128",
      "--security-opt=no-new-privileges:true",
      "--cap-drop=ALL",
      "--user=65534",
      "--read-only",
      "--tmpfs",
      "/tmp:size=64m,nosuid,nodev",
    ];
    if (input_data != null) args.push("-e", `INPUT_DATA=${input_data}`);
    return args;
  }
}

function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const buf = Buffer.from(text);
  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return (
    buf.subarray(0, end).toString("utf8") +
    `\n[output truncated at ${maxBytes} bytes]`
  );
}
