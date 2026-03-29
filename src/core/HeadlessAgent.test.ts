import { test, expect, describe, mock } from "bun:test";
import { HeadlessAgent } from "./HeadlessAgent";
import type { AgentPlugin, ToolDefinition } from "./Plugin";
import type { LLMProvider } from "../providers/llm/LLMProvider";
import { AutoApprovePermissionManager, AutoDenyPermissionManager } from "./PermissionManager";

// Minimal LLMProvider stub
function makeLLM(response = "answer"): LLMProvider {
  return {
    chat: mock(async () => ({ nonReasoningContent: response, reasoningContent: "" })),
    embed: mock(async () => []),
  } as unknown as LLMProvider;
}

describe("HeadlessAgent.ask()", () => {
  test("each ask() is independent — no shared conversation state", async () => {
    const llm = makeLLM("reply");
    const agent = new HeadlessAgent(llm, [], "base prompt");

    await agent.ask("first");
    await agent.ask("second");

    // Each call to chat() should only have the single user message for that call
    const calls = (llm.chat as ReturnType<typeof mock>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toEqual([{ role: "user", content: "first" }]);
    expect(calls[1][0]).toEqual([{ role: "user", content: "second" }]);
  });

  test("system prompt includes base + plugin fragments + plugin context", async () => {
    const llm = makeLLM();
    const plugin: AgentPlugin = {
      name: "TestPlugin",
      getSystemPromptFragment: () => "FRAGMENT",
      getContext: async () => "CONTEXT",
    };
    const agent = new HeadlessAgent(llm, [plugin], "BASE");

    await agent.ask("hello");

    const systemPrompt: string = (llm.chat as ReturnType<typeof mock>).mock.calls[0][1];
    expect(systemPrompt).toContain("BASE");
    expect(systemPrompt).toContain("FRAGMENT");
    expect(systemPrompt).toContain("CONTEXT");
  });

  test("plugin getContext error does not crash ask()", async () => {
    const llm = makeLLM("ok");
    const plugin: AgentPlugin = {
      name: "BadPlugin",
      getContext: async () => { throw new Error("context failure"); },
    };
    const agent = new HeadlessAgent(llm, [plugin], "base");
    const result = await agent.ask("task");
    expect(result).toBe("ok");
  });

  test("plugin with no getContext or getSystemPromptFragment works fine", async () => {
    const llm = makeLLM("ok");
    const plugin: AgentPlugin = { name: "EmptyPlugin" };
    const agent = new HeadlessAgent(llm, [plugin], "base");
    await expect(agent.ask("task")).resolves.toBe("ok");
  });

  test("tool implementations are wrapped with permission checks (auto-deny)", async () => {
    const llm = makeLLM("done");
    const executeTool = mock(async () => "result");
    const plugin: AgentPlugin = {
      name: "ToolPlugin",
      getTools: () => [{
        name: "my_tool",
        description: "test",
        parameters: {},
        permission: "per_call",
      }],
      executeTool,
    };
    const pm = new AutoDenyPermissionManager();
    const agent = new HeadlessAgent(llm, [plugin], "base", { permissionManager: pm });
    await agent.ask("task");

    // Get the wrapped tool implementation from the chat call
    const tools: ToolDefinition[] = (llm.chat as ReturnType<typeof mock>).mock.calls[0][3];
    const wrapped = tools[0].implementation!;

    const result = await wrapped({});
    // AutoDeny should block, so executeTool should NOT have been called
    expect(executeTool).not.toHaveBeenCalled();
    expect(result).toEqual({ error: "Permission denied by user." });
  });

  test("tool with permission=none skips the permission check", async () => {
    const llm = makeLLM("done");
    const executeTool = mock(async () => "tool-result");
    const plugin: AgentPlugin = {
      name: "ToolPlugin",
      getTools: () => [{
        name: "free_tool",
        description: "test",
        parameters: {},
        permission: "none",
      }],
      executeTool,
    };
    const agent = new HeadlessAgent(llm, [plugin], "base");
    await agent.ask("task");

    const tools: ToolDefinition[] = (llm.chat as ReturnType<typeof mock>).mock.calls[0][3];
    const wrapped = tools[0].implementation!;

    const result = await wrapped({});
    expect(executeTool).toHaveBeenCalledWith("free_tool", {});
    expect(result).toBe("tool-result");
  });

  test("tool with permission approved by AutoApprovePermissionManager calls executeTool", async () => {
    const llm = makeLLM("done");
    const executeTool = mock(async () => "approved-result");
    const plugin: AgentPlugin = {
      name: "ToolPlugin",
      getTools: () => [{
        name: "secure_tool",
        description: "test",
        parameters: {},
        permission: "per_call",
      }],
      executeTool,
    };
    const pm = new AutoApprovePermissionManager();
    const agent = new HeadlessAgent(llm, [plugin], "base", { permissionManager: pm });
    await agent.ask("task");

    const tools: ToolDefinition[] = (llm.chat as ReturnType<typeof mock>).mock.calls[0][3];
    const wrapped = tools[0].implementation!;

    const result = await wrapped({ x: 1 });
    expect(executeTool).toHaveBeenCalledWith("secure_tool", { x: 1 });
    expect(result).toBe("approved-result");
  });

  test("onToolCallStart and onToolCallEnd events fire for each tool execution", async () => {
    const llm = makeLLM("done");
    const executeTool = mock(async () => "r");
    const plugin: AgentPlugin = {
      name: "ToolPlugin",
      getTools: () => [{ name: "t", description: "", parameters: {}, permission: "none" }],
      executeTool,
    };
    const agent = new HeadlessAgent(llm, [plugin], "base");

    const events: Array<{ event: string; name: string }> = [];
    agent.setToolCallHandler((event, name) => events.push({ event, name }));

    await agent.ask("task");
    const tools: ToolDefinition[] = (llm.chat as ReturnType<typeof mock>).mock.calls[0][3];
    await tools[0].implementation!({});

    expect(events).toEqual([
      { event: "start", name: "t" },
      { event: "end", name: "t" },
    ]);
  });

  test("plugin lifecycle: onInit is NOT called by HeadlessAgent", async () => {
    const llm = makeLLM("ok");
    const onInit = mock(() => {});
    const plugin: AgentPlugin = { name: "P", onInit };
    const agent = new HeadlessAgent(llm, [plugin], "base");
    await agent.ask("task");
    expect(onInit).not.toHaveBeenCalled();
  });

  test("onMessage is NOT called by HeadlessAgent", async () => {
    const llm = makeLLM("ok");
    const onMessage = mock(async () => {});
    const plugin: AgentPlugin = { name: "P", onMessage };
    const agent = new HeadlessAgent(llm, [plugin], "base");
    await agent.ask("task");
    expect(onMessage).not.toHaveBeenCalled();
  });

  test("getMessages is NOT called by HeadlessAgent", async () => {
    const llm = makeLLM("ok");
    const getMessages = mock(() => []);
    const plugin: AgentPlugin = { name: "P", getMessages };
    const agent = new HeadlessAgent(llm, [plugin], "base");
    await agent.ask("task");
    expect(getMessages).not.toHaveBeenCalled();
  });

  test("augmentResponse is NOT called by HeadlessAgent", async () => {
    const llm = makeLLM("ok");
    const augmentResponse = mock(async (r: string) => r);
    const plugin: AgentPlugin = { name: "P", augmentResponse };
    const agent = new HeadlessAgent(llm, [plugin], "base");
    await agent.ask("task");
    expect(augmentResponse).not.toHaveBeenCalled();
  });

  test("returns nonReasoningContent from LLM", async () => {
    const llm = makeLLM("final answer");
    const agent = new HeadlessAgent(llm, [], "base");
    const result = await agent.ask("q");
    expect(result).toBe("final answer");
  });
});
