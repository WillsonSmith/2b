import type { AgentPlugin } from "../core/Plugin.ts";
import type { BaseAgent } from "../core/BaseAgent.ts";

/**
 * YieldPlugin — exposes the `yield_control` tool, allowing the LLM to cooperatively
 * pause mid-turn and await further instruction before continuing.
 *
 * When the LLM calls `yield_control`, the plugin:
 *   1. Calls agent.yieldControl(partial_result), which emits "speak" (if partial
 *      result provided) and "agent_yield", then suspends by returning a Promise.
 *   2. The LLM tool loop blocks on that Promise.
 *   3. When the user sends new input via addDirect(), the Promise resolves with
 *      the continuation text, which becomes the tool result.
 *   4. The LLM resumes its turn with the continuation as context.
 *
 * Auto-registered by CortexAgent alongside CortexMemoryPlugin and ThoughtPlugin.
 */
export class YieldPlugin implements AgentPlugin {
  name = "Yield";
  private agent: BaseAgent | null = null;

  onInit(agent: BaseAgent) {
    this.agent = agent;
  }

  getSystemPromptFragment(): string {
    return [
      "## Cooperative Yield",
      "Use `yield_control` when you have produced partial output and need additional",
      "input from the user before you can continue. Supply `partial_result` with",
      "whatever output you have ready — it will be spoken immediately while the agent",
      "waits. The tool returns with the user's continuation input as its result,",
      "allowing you to proceed with that context in the same turn.",
    ].join("\n");
  }

  getTools() {
    return [
      {
        name: "yield_control",
        description:
          "Pause execution and wait for the user to supply additional input before continuing the current task. Use when you have partial output and need clarification or more information to proceed. The tool resolves with the user's continuation text.",
        parameters: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description: "Why you are yielding — what information or instruction you need to continue.",
            },
            partial_result: {
              type: "string",
              description: "Optional output produced so far, spoken to the user while waiting.",
            },
          },
          required: ["reason"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name !== "yield_control") return undefined;
    if (!this.agent) throw new Error("YieldPlugin not initialized — onInit was not called.");

    const { reason, partial_result } = args as { reason: string; partial_result?: string };

    this.agent.emit("log", `[Yield] ${reason}`);
    const continuation = await this.agent.yieldControl(partial_result, reason);
    return `Resuming after yield. Continuation: ${continuation}`;
  }
}
