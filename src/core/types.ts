export interface AgentEventMap {
  interrupt: [];
  error: [err: Error];
  state_change: [state: "idle" | "thinking"];
  thought: [reasoningText: string];
  log: [message: string];
  speak: [response: string];
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
}
