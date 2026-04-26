import type {
  ActiveTool,
  AgentState,
  ChatMessage,
  DynamicAgentRecord,
} from "../types.ts";

export type { ActiveTool, AgentState, ChatMessage, DynamicAgentRecord };

export interface BehaviorRecord {
  id: string;
  text: string;
  weight: number;
}

export interface ContextualBehaviorRecord extends BehaviorRecord {
  score: number;
}

export interface ConflictRecord {
  newId: string;
  newText: string;
  conflictId: string;
  conflictText: string;
  score: number;
  timestamp: number;
}

export interface MemoryRow {
  id: string;
  text: string;
  timestamp: number;
  type: string;
  tags: string[];
  weight: number;
}

export interface TraceEntry {
  id: string;
  score: number;
}

export interface RetrievalTrace {
  timestamp: number;
  query_length: number;
  factual: TraceEntry[];
  procedure: TraceEntry[];
  recent_thoughts: Array<{ id: string }>;
}

export type PanelId = "memory" | "behaviors" | "conflicts" | "agents" | "trace";

export type WsMessage =
  | {
      type: "snapshot";
      messages: ChatMessage[];
      state: AgentState;
      activeTools: ActiveTool[];
      dynamicAgents: DynamicAgentRecord[];
    }
  | { type: "message"; message: ChatMessage }
  | { type: "message_updated"; message: ChatMessage }
  | { type: "state_change"; state: AgentState }
  | { type: "active_tools_changed"; tools: ActiveTool[] }
  | { type: "dynamic_agents_changed"; agents: DynamicAgentRecord[] }
  | {
      type: "permission_request";
      request: {
        agentName: string;
        toolName: string;
        args: Record<string, unknown>;
      };
    }
  | { type: "agent_yield"; reason: string | undefined; partialResult: string | undefined }
  | { type: "model_changed"; model: string }
  | { type: "system_prompt"; systemPrompt: string; model: string }
  | {
      type: "behavior_conflict";
      newId: string;
      newText: string;
      conflictId: string;
      conflictText: string;
      score: number;
    }
  | {
      type: "behaviors_loaded";
      core: BehaviorRecord[];
      contextual: ContextualBehaviorRecord[];
    };

export interface PermissionRequest {
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface YieldRequest {
  reason: string | undefined;
  partialResult: string | undefined;
}

const MAX_ARG_VALUE_LENGTH = 200;

export function truncateArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > MAX_ARG_VALUE_LENGTH) {
      out[k] = `${v.slice(0, MAX_ARG_VALUE_LENGTH)}… [${v.length} total chars]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export const HELP_TEXT = `Available slash commands:
  /help              — show this list
  /clear             — clear the chat display
  /reasoning         — toggle reasoning/thinking display
  /model [name]      — show current model or switch to a new one
  /retry             — resend the last user message
  /copy              — copy the last response to clipboard
  /export [filename] — save the conversation to a file
  /system            — show the current system prompt
  /interrupt         — stop the agent mid-response (also available via ■ Stop button)`;
