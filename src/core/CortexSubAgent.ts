import type { LLMProvider } from "../providers/llm/LLMProvider.ts";
import type { AgentConfig } from "./types.ts";
import type { PermissionManager } from "./PermissionManager.ts";
import { CortexAgent } from "./CortexAgent.ts";
import { logger } from "../logger.ts";

const DEFAULT_ASK_TIMEOUT_MS = 120_000; // 2 minutes

export interface CortexSubAgentOptions {
  permissionManager?: PermissionManager;
  /** Hard cap per ask() call. Defaults to 120s. */
  timeoutMs?: number;
}

/**
 * Wraps a CortexAgent with a Promise-based ask() interface compatible with
 * SubAgentPlugin and DynamicAgentPlugin, while preserving full CortexAgent
 * capabilities: persistent semantic memory (in-memory SQLite), conversation
 * history, thought and behavior persistence across calls.
 *
 * The inner CortexAgent is started once and kept alive for the session.
 * Each ask() call is sequential — concurrent calls are serialized via a queue.
 */
export class CortexSubAgent {
  private readonly agent: CortexAgent;
  private readonly agentName: string;
  private readonly timeoutMs: number;
  private toolCallHandler?: (name: string, args: Record<string, unknown>) => void;
  private stateChangeHandler?: (state: "idle" | "thinking") => void;
  private errorHandler?: (err: Error) => void;
  private readyPromise: Promise<void>;

  // Serialize ask() calls so concurrent invocations don't cross-contaminate
  // the one-shot "speak" listener.
  private askQueue: Promise<unknown> = Promise.resolve();

  constructor(llm: LLMProvider, config: AgentConfig, options: CortexSubAgentOptions = {}) {
    this.agentName = config.name ?? config.cortexName ?? "CortexSubAgent";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_ASK_TIMEOUT_MS;

    this.agent = new CortexAgent(llm, {
      ...config,
      memoryDbPath: ":memory:", // session-scoped; no disk files
    });

    // Forward inner agent events to registered handlers so DynamicAgentPlugin
    // can surface them as parent-level lifecycle events.
    this.agent.on("subagent_tool_call", (_agentName, _agentToolName, toolName, args) => {
      this.toolCallHandler?.(toolName, args);
    });
    this.agent.on("state_change", (state) => {
      this.stateChangeHandler?.(state);
    });
    this.agent.on("error", (err) => {
      this.errorHandler?.(err);
    });

    // Start the agent immediately; ask() awaits this before sending input.
    this.readyPromise = this.agent.start().then(() => {
      logger.info("CortexSubAgent", `${this.agentName} started`);
    });
  }

  setToolCallHandler(fn: (name: string, args: Record<string, unknown>) => void): void {
    this.toolCallHandler = fn;
  }

  setStateChangeHandler(fn: (state: "idle" | "thinking") => void): void {
    this.stateChangeHandler = fn;
  }

  setErrorHandler(fn: (err: Error) => void): void {
    this.errorHandler = fn;
  }

  async stop(): Promise<void> {
    await this.agent.stop();
  }

  /**
   * Send a task to the agent and await its spoken response.
   * Calls are serialized — if a prior ask() is in flight, this one waits.
   */
  ask(task: string): Promise<string> {
    // Chain onto the queue so calls are processed one at a time.
    this.askQueue = this.askQueue.then(() => this.doAsk(task));
    return this.askQueue as Promise<string>;
  }

  private async doAsk(task: string): Promise<string> {
    await this.readyPromise;

    const { agentName, timeoutMs } = this;

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.agent.off("speak", onSpeak);
        this.agent.off("error", onError);
        reject(new Error(`CortexSubAgent "${agentName}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const onSpeak = (response: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.agent.off("error", onError);
        resolve(response);
      };

      const onError = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.agent.off("speak", onSpeak);
        reject(err);
      };

      this.agent.once("speak", onSpeak);
      this.agent.once("error", onError);

      logger.debug("CortexSubAgent", `${agentName} addDirect — task length: ${task.length}`);
      this.agent.addDirect(task);
    });
  }
}
