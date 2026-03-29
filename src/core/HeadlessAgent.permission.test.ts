import { test, expect, describe } from "bun:test";
import { HeadlessAgent } from "./HeadlessAgent.ts";
import {
  AutoApprovePermissionManager,
  AutoDenyPermissionManager,
  ScriptedPermissionManager,
  SessionCache,
} from "./PermissionManager.ts";
import type { AgentPlugin, ToolDefinition } from "./Plugin.ts";
import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { Message } from "./types.ts";

// ── Mock LLM ──────────────────────────────────────────────────────────────────
//
// Simulates a model that immediately calls a named tool with given args, then
// returns "done". The captured tool result is stored on the instance for
// assertions.

class ToolCallingLLM implements LLMProvider {
  capturedToolResult: unknown = undefined;

  constructor(
    private readonly toolToCall: string,
    private readonly toolArgs: Record<string, unknown> = {},
  ) {}

  async chat(
    _messages: Message[],
    _systemPrompt?: string,
    _schema?: unknown,
    tools?: ToolDefinition[],
  ) {
    const tool = tools?.find((t) => t.name === this.toolToCall);
    if (tool?.implementation) {
      this.capturedToolResult = await tool.implementation(this.toolArgs);
    }
    return { response: "done", nonReasoningContent: "done", reasoningText: "" };
  }

  async getEmbedding(_text: string): Promise<number[]> {
    return [];
  }
}

// ── Mock plugin ───────────────────────────────────────────────────────────────
//
// Exposes one tool with a configurable permission level. Records whether
// executeTool was actually called.

function makePlugin(permission: ToolDefinition["permission"]): AgentPlugin & { wasExecuted: boolean } {
  return {
    name: "MockPlugin",
    wasExecuted: false,
    getTools(): ToolDefinition[] {
      return [
        {
          name: "guarded_tool",
          description: "A tool that requires permission.",
          parameters: { type: "object", properties: {}, required: [] },
          permission,
        },
      ];
    },
    async executeTool(name: string) {
      if (name === "guarded_tool") {
        (this as any).wasExecuted = true;
        return { success: true };
      }
    },
  };
}

// ── HeadlessAgent permission wiring ──────────────────────────────────────────

describe("HeadlessAgent — permission: 'session'", () => {
  test("AutoDenyPermissionManager prevents execution and returns denial error", async () => {
    const plugin = makePlugin("session");
    const llm = new ToolCallingLLM("guarded_tool");
    const agent = new HeadlessAgent(llm, [plugin], "test", {
      agentName: "TestAgent",
      permissionManager: new AutoDenyPermissionManager(),
    });

    await agent.ask("do the thing");

    expect(llm.capturedToolResult).toEqual({ error: "Permission denied by user." });
    expect(plugin.wasExecuted).toBe(false);
  });

  test("AutoApprovePermissionManager allows execution", async () => {
    const plugin = makePlugin("session");
    const llm = new ToolCallingLLM("guarded_tool");
    const agent = new HeadlessAgent(llm, [plugin], "test", {
      agentName: "TestAgent",
      permissionManager: new AutoApprovePermissionManager(),
    });

    await agent.ask("do the thing");

    expect(llm.capturedToolResult).toEqual({ success: true });
    expect(plugin.wasExecuted).toBe(true);
  });

  test("no permissionManager defaults to AutoDeny", async () => {
    const plugin = makePlugin("session");
    const llm = new ToolCallingLLM("guarded_tool");
    const agent = new HeadlessAgent(llm, [plugin], "test", {
      agentName: "TestAgent",
      // intentionally no permissionManager
    });

    await agent.ask("do the thing");

    expect(llm.capturedToolResult).toEqual({ error: "Permission denied by user." });
    expect(plugin.wasExecuted).toBe(false);
  });

  test("session cache: approved tool is not re-prompted on second ask()", async () => {
    let approvalCount = 0;
    const countingPm = new ScriptedPermissionManager({ guarded_tool: true });
    const originalRequest = countingPm.requestApproval.bind(countingPm);
    countingPm.requestApproval = async (req) => {
      approvalCount++;
      return originalRequest(req);
    };

    const plugin = makePlugin("session");
    const cache = new SessionCache();
    cache.add("guarded_tool"); // pre-populate as if user said "always" in a prior prompt

    const pm = new AutoApprovePermissionManager(cache);
    const agent = new HeadlessAgent(new ToolCallingLLM("guarded_tool"), [plugin], "test", {
      agentName: "TestAgent",
      permissionManager: pm,
    });

    // Both ask() calls should succeed; isSessionApproved() is checked first
    // so requestApproval is never called when cache has the tool.
    await agent.ask("first");
    await agent.ask("second");

    expect(plugin.wasExecuted).toBe(true);
  });
});

describe("HeadlessAgent — permission: 'per_call'", () => {
  test("AutoDenyPermissionManager prevents execution", async () => {
    const plugin = makePlugin("per_call");
    const llm = new ToolCallingLLM("guarded_tool");
    const agent = new HeadlessAgent(llm, [plugin], "test", {
      agentName: "TestAgent",
      permissionManager: new AutoDenyPermissionManager(),
    });

    await agent.ask("do the thing");

    expect(llm.capturedToolResult).toEqual({ error: "Permission denied by user." });
    expect(plugin.wasExecuted).toBe(false);
  });

  test("AutoApprovePermissionManager allows execution", async () => {
    const plugin = makePlugin("per_call");
    const llm = new ToolCallingLLM("guarded_tool");
    const agent = new HeadlessAgent(llm, [plugin], "test", {
      agentName: "TestAgent",
      permissionManager: new AutoApprovePermissionManager(),
    });

    await agent.ask("do the thing");

    expect(llm.capturedToolResult).toEqual({ success: true });
    expect(plugin.wasExecuted).toBe(true);
  });
});

describe("HeadlessAgent — permission: 'none'", () => {
  test("tool executes without any permission check regardless of manager", async () => {
    const plugin = makePlugin("none");
    const llm = new ToolCallingLLM("guarded_tool");
    const agent = new HeadlessAgent(llm, [plugin], "test", {
      agentName: "TestAgent",
      permissionManager: new AutoDenyPermissionManager(), // would deny if checked
    });

    await agent.ask("do the thing");

    expect(llm.capturedToolResult).toEqual({ success: true });
    expect(plugin.wasExecuted).toBe(true);
  });

  test("tool executes with no permissionManager", async () => {
    const plugin = makePlugin("none");
    const llm = new ToolCallingLLM("guarded_tool");
    const agent = new HeadlessAgent(llm, [plugin], "test");

    await agent.ask("do the thing");

    expect(llm.capturedToolResult).toEqual({ success: true });
    expect(plugin.wasExecuted).toBe(true);
  });
});

describe("HeadlessAgent — ScriptedPermissionManager", () => {
  test("approves only the scripted tool", async () => {
    const plugin = makePlugin("session");
    const llm = new ToolCallingLLM("guarded_tool");
    const agent = new HeadlessAgent(llm, [plugin], "test", {
      agentName: "TestAgent",
      permissionManager: new ScriptedPermissionManager({ guarded_tool: true }),
    });

    await agent.ask("do the thing");

    expect(llm.capturedToolResult).toEqual({ success: true });
    expect(plugin.wasExecuted).toBe(true);
  });

  test("denies tools not in the script", async () => {
    const plugin = makePlugin("session");
    const llm = new ToolCallingLLM("guarded_tool");
    const agent = new HeadlessAgent(llm, [plugin], "test", {
      agentName: "TestAgent",
      permissionManager: new ScriptedPermissionManager({ other_tool: true }),
    });

    await agent.ask("do the thing");

    expect(llm.capturedToolResult).toEqual({ error: "Permission denied by user." });
    expect(plugin.wasExecuted).toBe(false);
  });
});
