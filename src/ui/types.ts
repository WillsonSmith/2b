export type MessageStatus = "pending" | "streaming" | "complete" | "error";
export type MessageRole = "user" | "assistant" | "system";
export type AgentState = "idle" | "thinking";

export interface ActiveTool {
  name: string;
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
