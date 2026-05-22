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
  tool_result: [name: string, error?: string];
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
  /** Emitted when the agent yields control mid-turn, awaiting user continuation. */
  "agent_yield": [reason: string | undefined, partialResult: string | undefined];
  /** Per-tick timing and size breakdown for performance analysis. Emitted at the end of each tick. */
  tick_metrics: [metrics: TickMetrics];
  /**
   * Emitted by tick() when it short-circuits because the agent is already
   * mid-turn (isThinking=true) but the queues are non-empty — i.e. the input
   * is waiting and will be processed when the current tick finishes. Lets UIs
   * surface "your message is queued" without polling.
   */
  queued: [depth: { directDepth: number; ambientDepth: number }];
  /**
   * Emitted when the agent's base system prompt has been replaced at runtime
   * via setSystemPrompt(). The payload is the prompt that will be used on the
   * next tick — for CortexAgent this is the augmented version (directives
   * already appended), not the raw value the caller passed in.
   */
  system_prompt_updated: [newSystemPrompt: string];
}

/**
 * Per-tick performance breakdown. Emitted at the end of every act() call.
 * All durations in milliseconds; all sizes in characters.
 */
export interface TickMetrics {
  /** Wall time for the whole tick (collect → llm → augment → dispatch). */
  totalMs: number;
  /** Wall time for the LLM call alone. Usually dominates totalMs. */
  llmMs: number;
  /** Wall time collecting history from all plugins' getMessages. */
  collectMessagesMs: number;
  /** Wall time collecting system prompt fragments + context from all plugins. */
  collectSystemPromptMs: number;
  /** Per-plugin breakdown of getContext + getSystemPromptFragment time, keyed by plugin name. */
  pluginContextMs: Record<string, number>;
  /** Wall time for the augmentResponse chain. */
  augmentMs: number;
  /** Wall time dispatching onMessage to all plugins (assistant message only). */
  dispatchMs: number;
  /** Assembled system prompt size in chars. */
  systemPromptChars: number;
  /** Serialized tool list size in chars (best-effort JSON.stringify). */
  toolsChars: number;
  /** Total chars in conversation history sent to the LLM. */
  historyChars: number;
  /** Number of tools available this tick. */
  toolCount: number;
  /** Number of plugins that contributed a getContext block. */
  contextContributors: number;
  /** Per-tool invocation count during this tick. Empty when no tools fired. */
  toolsCalled: Record<string, number>;
  /** Whether the LLM response was [IGNORE]-suppressed (ambient-only). */
  ignored: boolean;
  /**
   * Whether the tick threw — set by act() in its catch path before rethrowing.
   * When true, downstream fields (llmMs, augmentMs, dispatchMs, etc.) reflect
   * partial progress up to the failure point and may be zero if the error fired
   * before the relevant stage ran.
   */
  errored: boolean;
  /**
   * Total tool-retry attempts charged during the tick. A tool that succeeds on
   * its first try contributes 0; a tool with maxAttempts=3 that fails twice
   * before succeeding contributes 2. Useful for spotting flaky tools / endpoints.
   */
  retries: number;
  /** Whether the tick's AbortController fired before act() returned. */
  aborted: boolean;
  /**
   * Combined queue depth (direct + ambient) observed when act() began. Lets
   * observers distinguish "agent kept up with input" from "agent ran behind."
   */
  queueDepthAtStart: number;
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

/**
 * Thrown by `BaseAgent.yieldControl()` when the in-flight tick is interrupted
 * before continuation input arrives. The retry loop in BaseAgent.buildTools
 * treats this class as non-retryable — burning retries on an explicit interrupt
 * would just produce N copies of the same "Yield interrupted." error.
 */
export class YieldInterruptedError extends Error {
  constructor() {
    super("Yield interrupted.");
    this.name = "YieldInterruptedError";
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
  /**
   * Platform implementation (filesystem + SQLite). Defaults to BunPlatform when running in Bun.
   * Pass a NodePlatform here when running the framework in Electron's main process (Node.js).
   */
  platform?: import("../platform/IPlatform.ts").IPlatform;
}
