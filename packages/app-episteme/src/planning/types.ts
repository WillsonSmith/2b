export type PlanApprovalMode = "all" | "per_step";

export type PlanState =
  | "structuring"
  | "awaiting_approval"
  | "awaiting_step"
  | "executing"
  | "step_failed"
  | "paused"
  | "complete"
  | "cancelled";

export type StepState =
  | "pending"
  | "awaiting_approval"
  | "running"
  | "complete"
  | "failed"
  | "skipped";

export type EpistemePlanStepType =
  | "research"
  | "outline"
  | "draft"
  | "edit"
  | "cite"
  | "analyze"
  | "organize";

export interface EpistemePlanStep {
  id: string;
  planId: string;
  index: number;
  type: EpistemePlanStepType;
  title: string;
  instruction: string;
  state: StepState;
  fullResult?: string;
  contextSummary?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface EpistemePlan {
  id: string;
  goal: string;
  state: PlanState;
  approvalMode: PlanApprovalMode;
  trigger: "user_goal" | "document";
  triggerDocument?: string;
  steps: EpistemePlanStep[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface PlanStepDraft {
  type: EpistemePlanStepType;
  title: string;
  instruction: string;
}
