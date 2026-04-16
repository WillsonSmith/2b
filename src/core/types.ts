export interface AmbientOptions {
  forceTick?: boolean;
}

/**
 * A request from any plugin to persist content to long-term memory.
 * Emitted via BaseAgent.requestMemoryWrite() and consumed by CortexMemoryPlugin
 * (or any plugin that implements the memory broker role).
 * If no broker is registered the event fires into the void — graceful no-op.
 */
export interface MemoryWriteRequest {
  text: string;
  type: "factual" | "thought" | "behavior" | "procedure";
  tags?: string[];
  source: string;
}

export interface AgentEventMap {
  interrupt: [];
  error: [err: Error];
  state_change: [state: "idle" | "thinking"];
  thought: [reasoningText: string];
  log: [message: string];
  speak: [response: string];
  tool_call: [name: string, args: Record<string, unknown>];
  tool_result: [name: string];
  subagent_tool_call: [agentName: string, agentToolName: string, toolName: string, args: Record<string, unknown>];
  subagent_token: [agentName: string, token: string, isReasoning: boolean];
  tool_call_blocked: [name: string, args: Record<string, unknown>, reason: string];
  agent_spawned: [agentName: string, agentType: "headless" | "cortex", capabilities: string[]];
  agent_state_change: [agentName: string, state: "idle" | "thinking"];
  agent_error: [agentName: string, err: Error];
  /** Emitted by plugins that produce content for long-term persistence. */
  "memory:write_request": [request: MemoryWriteRequest];
}

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export interface AgentConfig {
  model: string;
  embeddingModel?: string;
  systemPrompt: string;
  /** How the agent calls tools. "native" uses the model's built-in tool protocol.
   *  "structured_output" uses constrained JSON decoding — works with any model. */
  toolCallingStrategy?: "native" | "structured_output";
  heartbeatInterval?: number;
  historyLimit?: number;
  name?: string;
  cortexName?: string;
  /** Override the SQLite file path used by CortexMemoryPlugin. Pass ":memory:" in tests. */
  memoryDbPath?: string;
  /** Tune CortexMemoryPlugin context injection budgets. */
  memoryOptions?: {
    factualContextBudgetChars?: number;
    procedureContextBudgetChars?: number;
  };
  /** Permission manager for tools that declare permission !== "none". */
  permissionManager?: import("./PermissionManager.ts").PermissionManager;
}
