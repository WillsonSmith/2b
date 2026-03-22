import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import { logger } from "../logger.ts";
import { LMStudioClient, Chat } from "@lmstudio/sdk";

const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB
const MAX_INPUT_BYTES = 256 * 1024; // 256 KB
const DOCKER_IMAGE = "python:3.11-slim";
const DEFAULT_CODE_MODEL = "qwen2.5-coder-7b-instruct-mlx";

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

  constructor() {
    this.lmClient = new LMStudioClient();
    this.codeModel = process.env.CODE_MODEL ?? DEFAULT_CODE_MODEL;
  }

  onInit(_agent: BaseAgent): void {
    logger.info("CodeSandbox", `Pre-pulling ${DOCKER_IMAGE}...`);
    Bun.spawn(["docker", "pull", DOCKER_IMAGE], { stdout: "ignore", stderr: "ignore" }).exited
      .then(() => logger.info("CodeSandbox", `${DOCKER_IMAGE} ready`))
      .catch(() => logger.info("CodeSandbox", `Pre-pull failed — will pull on first run`));

    logger.info("CodeSandbox", `Code model: ${this.codeModel}`);
  }

  getSystemPromptFragment(): string {
    return [
      "You have access to a Python 3.11 code sandbox running in an isolated Docker container.",
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
          "A dedicated coding model will write the Python 3.11 code and execute it in an isolated Docker container. " +
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

  async executeTool(name: string, args: any): Promise<any> {
    if (name !== "execute_code") return undefined;

    const { task, input_data, timeout_ms } = args as {
      task: string;
      input_data?: string;
      timeout_ms?: number;
    };

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

    const code = await this.generateCode(codeGenPrompt);

    if (Buffer.byteLength(code) > MAX_INPUT_BYTES)
      throw new Error(`generated code exceeds maximum size of ${MAX_INPUT_BYTES} bytes`);

    logger.info("CodeSandbox", `Generated ${Buffer.byteLength(code)} bytes of Python`);
    logger.debug("CodeSandbox", `Generated code:\n${code}`);

    const dockerArgs = [
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

    if (input_data !== undefined && input_data !== null) {
      dockerArgs.push("-e", `INPUT_DATA=${input_data}`);
    }

    dockerArgs.push(DOCKER_IMAGE, "python", "-c", code);

    logger.info("CodeSandbox", `Launching container (timeout: ${timeout}ms)`);

    const proc = Bun.spawn(dockerArgs, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeoutRace = new Promise<"timeout">((resolve) =>
      setTimeout(() => {
        proc.kill();
        resolve("timeout");
      }, timeout),
    );

    const result = await Promise.race([proc.exited, timeoutRace]);
    const timedOut = result === "timeout";
    const exitCode = timedOut ? null : (result as number);

    const [stdoutRaw, stderrRaw] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

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

  private async generateCode(prompt: string): Promise<string> {
    const modelClient = await this.lmClient.llm.model(this.codeModel);
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
  return Buffer.from(text).slice(0, maxBytes).toString("utf8") +
    `\n[output truncated at ${maxBytes} bytes]`;
}
