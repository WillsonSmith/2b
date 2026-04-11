export type MessageStatus = "pending" | "streaming" | "complete" | "error";
export type MessageRole = "user" | "assistant" | "system";
export type AgentState = "idle" | "thinking";
export type DynamicAgentState = "idle" | "thinking" | "error";

export interface ActiveTool {
  name: string;
  /** Which dynamic agent owns this tool call. undefined = orchestrator. */
  agentName?: string;
  /** Set when this tool is a sub-agent and it has started a child tool. */
  currentSubTool?: string;
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  thought?: string;
  toolCalls: ToolCallRecord[];
  status: MessageStatus;
  timestamp: Date;
}

export interface DynamicAgentRecord {
  name: string;
  type: "headless" | "cortex";
  capabilities: string[];
  state: DynamicAgentState;
  /** ISO string — safe for JSON serialization. */
  createdAt: string;
}

export interface ChatSessionSnapshot {
  messages: (Omit<ChatMessage, "timestamp"> & { timestamp: string })[];
  state: AgentState;
  activeTools: ActiveTool[];
  dynamicAgents: DynamicAgentRecord[];
}
