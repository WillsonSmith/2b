import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";
import { logger } from "../logger.ts";

const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB
const MAX_INPUT_BYTES = 256 * 1024; // 256 KB
const DOCKER_IMAGE = "python:3.11-slim";

export class CodeSandboxPlugin implements AgentPlugin {
  name = "CodeSandbox";

  onInit(_agent: BaseAgent): void {
    // Pre-pull the image so first execution isn't slow
    logger.info("CodeSandbox", `Pre-pulling ${DOCKER_IMAGE}...`);
    Bun.spawn(["docker", "pull", DOCKER_IMAGE], { stdout: "ignore", stderr: "ignore" }).exited
      .then(() => logger.info("CodeSandbox", `${DOCKER_IMAGE} ready`))
      .catch(() => logger.info("CodeSandbox", `Pre-pull failed — will pull on first run`));
  }

  getSystemPromptFragment(): string {
    return [
      "You have access to a code sandbox that executes Python 3.11 inside an isolated Docker container.",
      "Use execute_code to write custom code for data processing, calculations, transformations, or any programmatic task.",
      "Code has no network access and no access to the host filesystem.",
      "Use print() to output results — stdout is captured and returned.",
      "Pass data in via the input_data parameter (JSON string); read it with:",
      "import os, json; data = json.loads(os.environ.get('INPUT_DATA', 'null'))",
    ].join(" ");
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "execute_code",
        description:
          "Execute a Python 3.11 snippet inside an isolated Docker container. " +
          "No network access. No host filesystem access. Standard library only. " +
          "Use print() to produce output — stdout and stderr are captured and returned. " +
          "Returns { stdout, stderr, exitCode, success, timedOut }.",
        parameters: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "The Python code to run. Use print() to output results.",
            },
            input_data: {
              type: "string",
              description:
                "Optional JSON string passed via INPUT_DATA env var. " +
                "Read it with: import os, json; data = json.loads(os.environ.get('INPUT_DATA', 'null'))",
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

  async executeTool(name: string, args: any): Promise<any> {
    if (name !== "execute_code") return undefined;

    const { code, input_data, timeout_ms } = args as {
      code: string;
      input_data?: string;
      timeout_ms?: number;
    };

    if (Buffer.byteLength(code) > MAX_INPUT_BYTES)
      throw new Error(`code exceeds maximum size of ${MAX_INPUT_BYTES} bytes`);

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

    const dockerArgs = [
      "docker", "run",
      "--rm",
      "--network=none",
      "--memory=256m",
      "--cpus=0.5",
      "--pids-limit=64",
      "--no-new-privileges",
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
    };
  }
}

function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  return Buffer.from(text).slice(0, maxBytes).toString("utf8") +
    `\n[output truncated at ${maxBytes} bytes]`;
}
