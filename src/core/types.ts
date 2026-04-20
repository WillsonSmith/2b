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
  /** Emitted by BehaviorPlugin when a newly saved behavior semantically conflicts with an existing one. */
  "behavior:conflict_detected": [newId: string, newText: string, conflictId: string, conflictText: string, score: number];
  /** Emitted by BehaviorPlugin after each turn's system prompt fragment is assembled. */
  "behaviors_loaded": [core: Array<{ id: string; text: string; weight: number }>, contextual: Array<{ id: string; text: string; score: number; weight: number }>];
  /** Emitted when the agent yields control mid-turn, optionally with a partial result already spoken. */
  "agent_yield": [partialResult: string | undefined];
}

/**
 * Result returned by a tool's `verifyAfter` hook. When `passed` is false,
 * BaseAgent appends a `[Verification failed: message]` suffix to the tool
 * result string returned to the LLM, and emits a "log" event.
 */
export interface VerificationResult {
  passed: boolean;
  /** The actual value observed (for human-readable context in the failure message). */
  actual: string;
  /** The expected value or condition (for human-readable context). */
  expected: string;
  /** Short human-readable summary, included in the LLM failure suffix. */
  message: string;
}

/**
 * Thrown by a tool implementation to signal cooperative yield.
 * The agent emits any partialResult as a "speak" event, then suspends
 * until the next addDirect() call resumes it with continuation input.
 * Prefer calling agent.yieldControl() from within a tool rather than throwing
 * this directly, which requires the LLM provider to propagate it correctly.
 */
export class YieldSignal extends Error {
  constructor(public readonly partialResult?: string) {
    super("yield");
    this.name = "YieldSignal";
  }
}

export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type PlanStepStatus = "pending" | "in_progress" | "done" | "skipped" | "failed";
export type PlanStatus = "active" | "completed" | "abandoned";

export interface PlanStep {
  id: string;
  planId: string;
  position: number;
  description: string;
  status: PlanStepStatus;
  notes: string | null;
}

export interface Plan {
  id: string;
  goal: string;
  status: PlanStatus;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
}

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
