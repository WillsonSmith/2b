import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import { logger } from "../logger.ts";
import { LMStudioClient, Chat } from "@lmstudio/sdk";

const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB
const MAX_INPUT_BYTES = 256 * 1024; // 256 KB
const CONTAINER_IMAGE = "python:3.11-slim";
const DEFAULT_CODE_MODEL = "qwen2.5-coder-7b-instruct-mlx";

type ContainerRuntime = "docker" | "apple-container";

async function detectRuntime(): Promise<ContainerRuntime> {
  if (process.platform !== "darwin") return "docker";
  const proc = Bun.spawn(["which", "container"], { stdout: "pipe", stderr: "ignore" });
  await proc.exited;
  const out = await new Response(proc.stdout).text();
  return out.trim().length > 0 ? "apple-container" : "docker";
}

const CODE_GEN_SYSTEM_PROMPT = [
  "You are an expert Python 3.11 programmer.",
  "When given a task, respond with ONLY the Python code to accomplish it — no explanation, no markdown fences, no commentary.",
  "Use print() to output all results.",
  "Only use the Python standard library.",
  "Code runs in an isolated environment with no network access and no filesystem access (only /tmp is writable).",
].join(" ");

function stripCodeFences(text: string): string {
  // Remove ```python ... ``` or ``` ... ``` wrappers
  return text
    .replace(/^```(?:python)?\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

export class CodeSandboxPlugin implements AgentPlugin {
  name = "CodeSandbox";
  private lmClient: LMStudioClient;
  private codeModel: string;
  private runtime: ContainerRuntime = "docker";
  private initPromise: Promise<void> | null = null;
  private modelClient: Awaited<ReturnType<LMStudioClient["llm"]["model"]>> | null = null;

  constructor() {
    this.lmClient = new LMStudioClient();
    this.codeModel = process.env.CODE_MODEL ?? DEFAULT_CODE_MODEL;
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize().catch((err) => {
        // Reset so the next call can retry rather than immediately re-rejecting.
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    this.runtime = await detectRuntime();
    logger.info("CodeSandbox", `Runtime: ${this.runtime}`);

    if (this.runtime === "apple-container") {
      logger.info("CodeSandbox", "Starting container system...");
      const startProc = Bun.spawn(["container", "system", "start"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      await startProc.exited;
      logger.info("CodeSandbox", "Container system ready");
    }

    const pullCmd = this.runtime === "apple-container"
      ? ["container", "pull", CONTAINER_IMAGE]
      : ["docker", "pull", CONTAINER_IMAGE];

    logger.info("CodeSandbox", `Pre-pulling ${CONTAINER_IMAGE}...`);
    await Bun.spawn(pullCmd, { stdout: "ignore", stderr: "ignore" }).exited
      .then(() => logger.info("CodeSandbox", `${CONTAINER_IMAGE} ready`))
      .catch(() => logger.info("CodeSandbox", `Pre-pull failed — will pull on first run`));

    logger.info("CodeSandbox", `Code model: ${this.codeModel}`);
  }

  async onInit(_agent: BaseAgent): Promise<void> {
    // Eagerly initialize when running under BaseAgent so the image is
    // pre-pulled before the first user request.
    await this.ensureInitialized();
  }

  getSystemPromptFragment(): string {
    return [
      "You have access to a Python 3.11 code sandbox running in an isolated container.",
      "Use execute_code to run computations, data processing, calculations, or any programmatic task.",
      "Describe what the code should do in plain language via the 'task' parameter — a dedicated coding model will write the Python for you.",
      "Pass structured data in via 'input_data' (a JSON string); the code can read it with:",
      "import os, json; data = json.loads(os.environ.get('INPUT_DATA', 'null'))",
      "Code has no network access and no access to the host filesystem.",
    ].join(" ");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "execute_code",
        description:
          "Describe a Python computation task in plain language. " +
          "A dedicated coding model will write the Python 3.11 code and execute it in an isolated container. " +
          "No network access. No host filesystem access. Standard library only. " +
          "Returns { stdout, stderr, exitCode, success, timedOut, generatedCode }.",
        parameters: {
          type: "object",
          properties: {
            task: {
              type: "string",
              description:
                "Plain-language description of what the Python code should do. " +
                "Be specific: include expected inputs, outputs, and any logic details.",
            },
            input_data: {
              type: "string",
              description:
                "Optional JSON string passed to the code via INPUT_DATA env var. " +
                "The generated code will read it with: import os, json; data = json.loads(os.environ.get('INPUT_DATA', 'null'))",
            },
            timeout_ms: {
              type: "number",
              description: `Execution timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).`,
            },
          },
          required: ["task"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name !== "execute_code") return undefined;

    await this.ensureInitialized();

    const { task, input_data, timeout_ms } = args as {
      task: string;
      input_data?: string;
      timeout_ms?: number;
    };

    if (typeof task !== "string" || task.trim().length === 0)
      throw new Error("task must be a non-empty string");
    const taskBytes = Buffer.byteLength(task);
    if (taskBytes > 4096)
      throw new Error("task exceeds maximum size of 4096 bytes");

    if (input_data !== undefined && input_data !== null) {
      if (Buffer.byteLength(input_data) > MAX_INPUT_BYTES)
        throw new Error(`input_data exceeds maximum size of ${MAX_INPUT_BYTES} bytes`);
      try {
        JSON.parse(input_data);
      } catch {
        throw new Error("input_data must be valid JSON");
      }
    }

    const timeout = Math.min(
      typeof timeout_ms === "number" && timeout_ms > 0 ? timeout_ms : DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );

    // Build the user prompt for code generation
    const inputNote =
      input_data != null
        ? "\n\nInput data is available via: import os, json; data = json.loads(os.environ.get('INPUT_DATA', 'null'))"
        : "";
    const codeGenPrompt = `Task: ${task}${inputNote}`;

    logger.info("CodeSandbox", `Generating code via ${this.codeModel}...`);

    // Cap code generation at MAX_TIMEOUT_MS so a slow or hung LM Studio call
    // does not block indefinitely (the per-execution timeout only covers the
    // container run, not the upstream LLM request).
    const code = await Promise.race([
      this.generateCode(codeGenPrompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Code generation timed out")), MAX_TIMEOUT_MS),
      ),
    ]);

    const codeBytes = Buffer.byteLength(code);
    if (codeBytes > MAX_INPUT_BYTES)
      throw new Error(`generated code exceeds maximum size of ${MAX_INPUT_BYTES} bytes`);

    logger.info("CodeSandbox", `Generated ${codeBytes} bytes of Python`);
    logger.debug("CodeSandbox", `Generated code:\n${code}`);

    const runArgs = this.buildRunArgs(input_data);
    runArgs.push(CONTAINER_IMAGE, "python", "-c", code);

    logger.info("CodeSandbox", `Launching container (timeout: ${timeout}ms)`);

    const proc = Bun.spawn(runArgs, {
      stdout: "pipe",
      stderr: "pipe",
    });

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

    const [stdoutRaw, stderrRaw] = await Promise.all([stdoutPromise, stderrPromise]);

    logger.info(
      "CodeSandbox",
      `Container finished — exit ${exitCode ?? "killed"}${timedOut ? " (timed out)" : ""}`,
    );

    return {
      stdout: truncate(stdoutRaw, MAX_OUTPUT_BYTES),
      stderr: truncate(stderrRaw, MAX_OUTPUT_BYTES),
      exitCode,
      success: exitCode === 0,
      timedOut,
      generatedCode: code,
    };
  }

  private buildRunArgs(input_data?: string | null): string[] {
    if (this.runtime === "apple-container") {
      // Apple Container uses VM-based isolation; network is disabled by not
      // attaching to any named network (omitting --network). --no-dns prevents
      // DNS resolution as an additional guard. Resource caps mirror Docker.
      const args = [
        "container", "run",
        "--rm",
        "--no-dns",
        "--memory", "256M",
        "--cpus", "0.5",
        "--ulimit", "nproc=64:64",
        "--uid", "65534",
        "--read-only",
        "--tmpfs", "/tmp",
      ];
      // INPUT_DATA is passed as a discrete array element to Bun.spawn — there
      // is no shell involved, so no shell injection is possible. The value is
      // visible in the container's environment (e.g. /proc/1/environ) but the
      // sandboxed process is expected to read it; this is intentional.
      if (input_data != null) args.push("-e", `INPUT_DATA=${input_data}`);
      return args;
    }

    // Docker with full hardening.
    // Trust boundary: generated code originates from an LLM and executes with
    // the container user's (65534) privileges. Resource caps (memory, CPU,
    // pids), --cap-drop=ALL, --network=none, and a read-only rootfs collectively
    // limit blast radius; no host resources are reachable from inside.
    const args = [
      "docker", "run",
      "--rm",
      "--network=none",
      "--memory=256m",
      "--cpus=0.5",
      "--pids-limit=64",
      "--security-opt=no-new-privileges:true",
      "--cap-drop=ALL",
      "--user=65534",
      "--read-only",
      "--tmpfs", "/tmp:size=32m,noexec,nosuid,nodev",
    ];
    // See note above re: shell injection safety.
    if (input_data != null) args.push("-e", `INPUT_DATA=${input_data}`);
    return args;
  }

  private async generateCode(prompt: string): Promise<string> {
    // Cache the model handle so we pay the resolution cost only once.
    if (!this.modelClient) {
      this.modelClient = await this.lmClient.llm.model(this.codeModel);
    }
    const modelClient = this.modelClient;
    const chat = Chat.from([
      { role: "system", content: CODE_GEN_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);

    let raw = "";
    for await (const fragment of modelClient.respond(chat)) {
      raw += fragment.content;
    }

    return stripCodeFences(raw);
  }
}

function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  // Walk back from maxBytes to the start of a UTF-8 codepoint boundary so we
  // never split a multi-byte character, which would yield replacement chars.
  const buf = Buffer.from(text);
  let end = maxBytes;
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8") +
    `\n[output truncated at ${maxBytes} bytes]`;
}
