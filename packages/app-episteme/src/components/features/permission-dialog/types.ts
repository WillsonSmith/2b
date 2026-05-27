export type Decision = "allow_once" | "allow_session" | "deny";

export interface PendingPrompt {
  id: string;
  agentName: string;
  toolName: string;
  args: Record<string, unknown>;
  fileDiff?: { path: string; currentContent: string; proposedContent: string };
}

export const CLIENT_TIMEOUT_MS = 30_000;
export const MAX_ARG_VALUE_PREVIEW = 4_000;
