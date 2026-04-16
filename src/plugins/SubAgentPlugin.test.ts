import { test, expect, describe, mock } from "bun:test";
import { SubAgentPlugin } from "./SubAgentPlugin";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockHeadlessAgent {
  ask: ReturnType<typeof mock>;
  setToolCallHandler: ReturnType<typeof mock>;
  setOnToken: ReturnType<typeof mock>;
  _fireToolCall: (name: string, args: any) => void;
}

function makeHeadlessAgent(askImpl?: (task: string) => Promise<string>): MockHeadlessAgent {
  let toolCallHandler: ((name: string, args: any) => void) | undefined;
  const agent: MockHeadlessAgent = {
    ask: mock(askImpl ?? (async () => "done")),
    setToolCallHandler: mock((handler: (name: string, args: any) => void) => {
      toolCallHandler = handler;
    }),
    setOnToken: mock((_fn: (token: string, isReasoning: boolean) => void) => {}),
    _fireToolCall: (name: string, args: any) => {
      toolCallHandler?.(name, args);
    },
  };
  return agent;
}

function makeParentAgent() {
  const emitted: { event: string; args: any[] }[] = [];
  return {
    emit: mock((event: string, ...args: any[]) => {
      emitted.push({ event, args });
    }),
    emitted,
  };
}

function makePlugin(
  agent: MockHeadlessAgent,
  opts?: { inactivityTimeoutMs?: number; absoluteTimeoutMs?: number },
) {
  return new SubAgentPlugin({
    toolName: "run_task",
    description: "Run a sub-task",
    agent: agent as any,
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Task truncation
// ---------------------------------------------------------------------------

describe("task truncation", () => {
  test("truncates task string at 10K chars", async () => {
    const agent = makeHeadlessAgent();
    const plugin = makePlugin(agent);
    const longTask = "x".repeat(15_000);
    await plugin.executeTool("run_task", { task: longTask });
    const calledWith = (agent.ask.mock.calls[0] as any[])[0] as string;
    expect(calledWith.length).toBe(10_000);
  });

  test("does not truncate tasks within limit", async () => {
    const agent = makeHeadlessAgent();
    const plugin = makePlugin(agent);
    const task = "short task";
    await plugin.executeTool("run_task", { task });
    const calledWith = (agent.ask.mock.calls[0] as any[])[0] as string;
    expect(calledWith).toBe(task);
  });
});

// ---------------------------------------------------------------------------
// No timeout configuration
// ---------------------------------------------------------------------------

describe("no timeout", () => {
  test("calls agent.ask directly without racing a timeout promise", async () => {
    const agent = makeHeadlessAgent(async () => "result");
    const plugin = makePlugin(agent);
    const result = await plugin.executeTool("run_task", { task: "do something" });
    expect(result).toBe("result");
    expect(agent.ask.mock.calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tool call forwarding
// ---------------------------------------------------------------------------

describe("tool call forwarding", () => {
  test("sub-agent tool calls are emitted on the parent agent", async () => {
    const subAgent = makeHeadlessAgent(async (_task) => {
      // Simulate a tool call from within the sub-agent
      subAgent._fireToolCall("search", { query: "hello" });
      return "done";
    });
    const parent = makeParentAgent();
    const plugin = makePlugin(subAgent);
    plugin.onInit(parent as any);

    await plugin.executeTool("run_task", { task: "do something" });

    const toolCallEvents = parent.emitted.filter((e) => e.event === "subagent_tool_call");
    expect(toolCallEvents).toHaveLength(1);
    // args: [agentName, agentToolName, toolName, toolArgs]
    expect(toolCallEvents[0]!.args[0]).toBe("run_task"); // agentName
    expect(toolCallEvents[0]!.args[1]).toBe("run_task"); // agentToolName
    expect(toolCallEvents[0]!.args[2]).toBe("search");   // toolName
  });
});

// ---------------------------------------------------------------------------
// Absolute timeout
// ---------------------------------------------------------------------------

describe("absolute timeout", () => {
  test("fires even if sub-agent keeps calling tools", async () => {
    const subAgent = makeHeadlessAgent(
      // Never resolves
      () => new Promise<string>(() => {}),
    );
    const plugin = makePlugin(subAgent, { absoluteTimeoutMs: 20 });
    plugin.onInit(makeParentAgent() as any);

    await expect(plugin.executeTool("run_task", { task: "run forever" })).rejects.toThrow(
      /exceeded absolute timeout/,
    );
  });
});

// ---------------------------------------------------------------------------
// Inactivity timeout
// ---------------------------------------------------------------------------

describe("inactivity timeout", () => {
  test("fires when sub-agent has no activity for the configured duration", async () => {
    const subAgent = makeHeadlessAgent(
      () => new Promise<string>(() => {}), // never resolves
    );
    const plugin = makePlugin(subAgent, { inactivityTimeoutMs: 20 });
    plugin.onInit(makeParentAgent() as any);

    await expect(plugin.executeTool("run_task", { task: "inactive" })).rejects.toThrow(
      /timed out due to inactivity/,
    );
  });

  test("tool calls from the sub-agent reset the inactivity timer", async () => {
    const subAgent = makeHeadlessAgent(async () => {
      // Wait a bit, then fire a tool call which should reset the timer
      await Bun.sleep(15);
      subAgent._fireToolCall("ping", {});
      // Wait again — total would exceed inactivity if not reset
      await Bun.sleep(15);
      return "done";
    });
    const parent = makeParentAgent();
    const plugin = makePlugin(subAgent, { inactivityTimeoutMs: 25 });
    plugin.onInit(parent as any);

    // Should complete because each tool call resets the 25ms timer
    const result = await plugin.executeTool("run_task", { task: "keep alive" });
    expect(result).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// Returns result (not throws) on success
// ---------------------------------------------------------------------------

describe("successful execution", () => {
  test("returns the agent response string", async () => {
    const agent = makeHeadlessAgent(async () => "agent response");
    const plugin = makePlugin(agent);
    const result = await plugin.executeTool("run_task", { task: "test" });
    expect(result).toBe("agent response");
  });

  test("returns undefined for unknown tool names", async () => {
    const agent = makeHeadlessAgent();
    const plugin = makePlugin(agent);
    const result = await plugin.executeTool("other_tool", { task: "test" });
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Concurrent invocations
// ---------------------------------------------------------------------------

describe("concurrent invocations", () => {
  test("each concurrent call has its own independent timeout", async () => {
    const resolveCallbacks: Array<(v: string) => void> = [];
    const subAgent = makeHeadlessAgent(
      () => new Promise<string>((resolve) => resolveCallbacks.push(resolve)),
    );
    const plugin = makePlugin(subAgent, { absoluteTimeoutMs: 50 });
    plugin.onInit(makeParentAgent() as any);

    // Start two concurrent calls
    const p1 = plugin.executeTool("run_task", { task: "task 1" });
    const p2 = plugin.executeTool("run_task", { task: "task 2" });

    // Resolve the first call before the timeout
    resolveCallbacks[0]?.("result 1");

    const r1 = await p1;
    expect(r1).toBe("result 1");

    // The second call should still time out independently
    await expect(p2).rejects.toThrow(/exceeded absolute timeout/);
  });
});
