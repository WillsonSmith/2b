import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { VerificationPlugin, fileContainsCheck, shellOutputCheck } from "./VerificationPlugin";
import { BaseAgent } from "../core/BaseAgent";
import type { AgentPlugin } from "../core/Plugin";
import type { LLMProvider } from "../providers/llm/LLMProvider";
import type { AgentConfig, VerificationResult } from "../core/types";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdir, rm, writeFile } from "node:fs/promises";

// ── Test helpers ───────────────────────────────────────────────────────────────

function makeLLM(response = "YES\nCondition is satisfied."): LLMProvider {
  return {
    chat: mock(async () => ({
      response,
      nonReasoningContent: response,
      reasoningContent: "",
      reasoningText: "",
    })),
    embed: mock(async () => []),
  } as unknown as LLMProvider;
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    model: "test",
    systemPrompt: "You are a test agent.",
    heartbeatInterval: 100000,
    ...overrides,
  };
}

function waitForEvent(agent: BaseAgent, event: string, timeoutMs = 300): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for '${event}'`)), timeoutMs);
    const handler = (...args: unknown[]) => {
      clearTimeout(t);
      agent.off(event as any, handler);
      resolve(args);
    };
    agent.on(event as any, handler);
  });
}

function waitForIdle(agent: BaseAgent, timeoutMs = 500): Promise<unknown[]> {
  return waitForEvent(agent, "state_change", timeoutMs, "idle");
}

// Unique temp directory per test run
const TMP_DIR = join(tmpdir(), `verify-plugin-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

// ── VerificationPlugin registration ───────────────────────────────────────────

describe("VerificationPlugin - registration", () => {
  test("exposes four tools", () => {
    const plugin = new VerificationPlugin(makeLLM());
    const tools = plugin.getTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("verify_file_contains");
    expect(names).toContain("verify_shell_output");
    expect(names).toContain("verify_memory_exists");
    expect(names).toContain("verify_expression");
    expect(tools).toHaveLength(4);
  });

  test("getSystemPromptFragment mentions all four tools", () => {
    const fragment = new VerificationPlugin(makeLLM()).getSystemPromptFragment();
    expect(fragment).toContain("verify_file_contains");
    expect(fragment).toContain("verify_shell_output");
    expect(fragment).toContain("verify_memory_exists");
    expect(fragment).toContain("verify_expression");
  });

  test("executeTool returns undefined for unknown tool name", async () => {
    const result = await new VerificationPlugin(makeLLM()).executeTool("unknown", {});
    expect(result).toBeUndefined();
  });
});

// ── verify_file_contains ──────────────────────────────────────────────────────

describe("verify_file_contains", () => {
  test("passes when file contains literal pattern", async () => {
    const file = join(TMP_DIR, "test.txt");
    await writeFile(file, "hello world");
    const result = await fileContainsCheck(file, "hello") as VerificationResult;
    expect(result.passed).toBe(true);
  });

  test("fails when file does not contain literal pattern", async () => {
    const file = join(TMP_DIR, "test.txt");
    await writeFile(file, "hello world");
    const result = await fileContainsCheck(file, "goodbye") as VerificationResult;
    expect(result.passed).toBe(false);
    expect(result.message).toContain("not found");
  });

  test("passes with regex pattern", async () => {
    const file = join(TMP_DIR, "test.txt");
    await writeFile(file, "version 1.2.3");
    const result = await fileContainsCheck(file, "\\d+\\.\\d+", true) as VerificationResult;
    expect(result.passed).toBe(true);
  });

  test("fails with non-matching regex", async () => {
    const file = join(TMP_DIR, "test.txt");
    await writeFile(file, "hello world");
    const result = await fileContainsCheck(file, "^\\d+$", true) as VerificationResult;
    expect(result.passed).toBe(false);
  });

  test("fails gracefully when file does not exist", async () => {
    const result = await fileContainsCheck(join(TMP_DIR, "nonexistent.txt"), "x") as VerificationResult;
    expect(result.passed).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  test("via executeTool route", async () => {
    const file = join(TMP_DIR, "via-tool.txt");
    await writeFile(file, "expected content here");
    const plugin = new VerificationPlugin(makeLLM());
    const result = await plugin.executeTool("verify_file_contains", {
      path: file,
      pattern: "expected content",
    }) as VerificationResult;
    expect(result.passed).toBe(true);
  });
});

// ── verify_shell_output ───────────────────────────────────────────────────────

describe("verify_shell_output", () => {
  test("passes when command output contains pattern", async () => {
    const result = await shellOutputCheck("echo hello world", "hello") as VerificationResult;
    expect(result.passed).toBe(true);
  });

  test("fails when command output does not contain pattern", async () => {
    const result = await shellOutputCheck("echo hello", "goodbye") as VerificationResult;
    expect(result.passed).toBe(false);
  });

  test("rejects disallowed command", async () => {
    const result = await shellOutputCheck("rm -rf /", "anything") as VerificationResult;
    expect(result.passed).toBe(false);
    expect(result.message).toContain("not permitted");
  });

  test("passes with regex pattern", async () => {
    const result = await shellOutputCheck("echo version 2.0", "\\d+\\.\\d+", true) as VerificationResult;
    expect(result.passed).toBe(true);
  });

  test("via executeTool route", async () => {
    const plugin = new VerificationPlugin(makeLLM());
    const result = await plugin.executeTool("verify_shell_output", {
      command: "echo test output",
      pattern: "test output",
    }) as VerificationResult;
    expect(result.passed).toBe(true);
  });
});

// ── verify_memory_exists ──────────────────────────────────────────────────────

describe("verify_memory_exists", () => {
  test("fails with message when no memoryPlugin provided", async () => {
    const plugin = new VerificationPlugin(makeLLM());
    const result = await plugin.executeTool("verify_memory_exists", { query: "anything" }) as VerificationResult;
    expect(result.passed).toBe(false);
    expect(result.message).toContain("CortexMemoryPlugin");
  });

  test("passes when mock memoryPlugin returns enough matches", async () => {
    const mockMemory = {
      queryMemoriesRaw: mock(() => [
        { id: "1", text: "the fact", timestamp: 0, type: "factual", tags: [], weight: 1 },
        { id: "2", text: "another fact", timestamp: 0, type: "factual", tags: [], weight: 1 },
      ]),
    } as any;
    const plugin = new VerificationPlugin(makeLLM(), mockMemory);
    const result = await plugin.executeTool("verify_memory_exists", {
      query: "fact",
      minimum_count: 2,
    }) as VerificationResult;
    expect(result.passed).toBe(true);
    expect(result.actual).toContain("2");
  });

  test("fails when fewer matches than minimum_count", async () => {
    const mockMemory = {
      queryMemoriesRaw: mock(() => [
        { id: "1", text: "the fact", timestamp: 0, type: "factual", tags: [], weight: 1 },
      ]),
    } as any;
    const plugin = new VerificationPlugin(makeLLM(), mockMemory);
    const result = await plugin.executeTool("verify_memory_exists", {
      query: "fact",
      minimum_count: 3,
    }) as VerificationResult;
    expect(result.passed).toBe(false);
    expect(result.message).toContain("Only 1");
  });
});

// ── verify_expression ─────────────────────────────────────────────────────────

describe("verify_expression", () => {
  test("passes when LLM responds YES", async () => {
    const llm = makeLLM("YES\nThe value is correct.");
    const plugin = new VerificationPlugin(llm);
    const result = await plugin.executeTool("verify_expression", {
      description: "the value is 42",
      actual_value: "42",
    }) as VerificationResult;
    expect(result.passed).toBe(true);
    expect(result.message).toContain("correct");
  });

  test("fails when LLM responds NO", async () => {
    const llm = makeLLM("NO\nThe value does not satisfy the condition.");
    const plugin = new VerificationPlugin(llm);
    const result = await plugin.executeTool("verify_expression", {
      description: "the value is 42",
      actual_value: "99",
    }) as VerificationResult;
    expect(result.passed).toBe(false);
  });

  test("fails gracefully when LLM throws", async () => {
    const llm = {
      chat: mock(async () => { throw new Error("LLM unavailable"); }),
      embed: mock(async () => []),
    } as unknown as LLMProvider;
    const plugin = new VerificationPlugin(llm);
    const result = await plugin.executeTool("verify_expression", {
      description: "anything",
      actual_value: "value",
    }) as VerificationResult;
    expect(result.passed).toBe(false);
    expect(result.message).toContain("Evaluator error");
  });
});

// ── verifyAfter hook in BaseAgent ─────────────────────────────────────────────

describe("verifyAfter hook - BaseAgent integration", () => {
  test("tool result is unchanged when verifyAfter passes", async () => {
    const executeTool = mock(async () => "write succeeded");
    const verifyAfter = mock(async () => ({
      passed: true,
      actual: "found",
      expected: "pattern",
      message: "ok",
    } satisfies VerificationResult));

    const plugin: AgentPlugin = {
      name: "P",
      getTools: () => [{
        name: "my_write",
        description: "",
        parameters: {},
        verifyAfter,
      }],
      executeTool,
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);
    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    const result = await tools[0].implementation({});
    expect(result).toBe("write succeeded");
    expect(verifyAfter).toHaveBeenCalledTimes(1);
    agent.stop();
  });

  test("tool result gets failure suffix when verifyAfter fails", async () => {
    const executeTool = mock(async () => "write done");
    const verifyAfter = mock(async () => ({
      passed: false,
      actual: "not found",
      expected: "hello",
      message: "Pattern missing from file.",
    } satisfies VerificationResult));

    const plugin: AgentPlugin = {
      name: "P",
      getTools: () => [{
        name: "my_write",
        description: "",
        parameters: {},
        verifyAfter,
      }],
      executeTool,
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);
    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    const result = await tools[0].implementation({});
    expect(result).toContain("write done");
    expect(result).toContain("[Verification failed: Pattern missing from file.]");
    agent.stop();
  });

  test("log event is emitted when verifyAfter fails", async () => {
    const verifyAfter = mock(async () => ({
      passed: false, actual: "x", expected: "y", message: "Bad output.",
    } satisfies VerificationResult));

    const plugin: AgentPlugin = {
      name: "P",
      getTools: () => [{ name: "t", description: "", parameters: {}, verifyAfter }],
      executeTool: mock(async () => "result"),
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);

    const logs: string[] = [];
    agent.on("log", (msg) => logs.push(msg));

    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    await tools[0].implementation({});

    expect(logs.some((l) => l.includes("[Verification failed]") && l.includes("Bad output."))).toBe(true);
    agent.stop();
  });

  test("verifyAfter throwing does not crash the tool call", async () => {
    const executeTool = mock(async () => "result");
    const verifyAfter = mock(async () => { throw new Error("verifier crashed"); });

    const plugin: AgentPlugin = {
      name: "P",
      getTools: () => [{ name: "t", description: "", parameters: {}, verifyAfter }],
      executeTool,
    };

    const llm = makeLLM();
    const agent = new BaseAgent(llm, makeConfig());
    agent.registerPlugin(plugin);
    agent.addDirect("go");
    await waitForIdle(agent);

    const tools = (llm.chat as ReturnType<typeof mock>).mock.calls[0]![3];
    const result = await tools[0].implementation({});
    // Tool result is returned unchanged; the verifier error was swallowed
    expect(result).toBe("result");
    agent.stop();
  });
});
