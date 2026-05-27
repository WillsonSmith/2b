import type { EpistemePlanStepType } from "../../../planning/types.ts";

export type SidecarMessage =
  | { role: "user"; text: string; id?: number }
  | { role: "assistant"; text: string; id?: number }
  | { role: "tool"; name: string; status: "calling" | "done" | "error"; error?: string }
  | { role: "notification"; text: string; actionLabel: string; onAction: () => void }
  | { role: "system_event"; text: string; plugin?: string }
  | { role: "empty_response"; hadThinking: boolean }
  | {
      role: "plan_step";
      planId: string;
      stepId: string;
      stepTitle: string;
      stepType: EpistemePlanStepType;
      state: "running" | "complete" | "failed";
      summary?: string;
      error?: string;
    };
