export type MessageStatus = "pending" | "streaming" | "complete" | "error";
export type MessageRole = "user" | "assistant" | "system";
export type AgentState = "idle" | "thinking";

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
