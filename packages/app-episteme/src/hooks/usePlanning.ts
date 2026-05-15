import { useCallback, useEffect, useState } from "react";
import type { Subscribe } from "./useWebSocket.ts";
import type { EpistemePlan, PlanStepDraft } from "../planning/types.ts";

export interface UsePlanningReturn {
  plan: EpistemePlan | null;
  requestPlan: (goal: string, approvalMode: "all" | "per_step") => void;
  requestPlanFromDocument: (path: string, goal: string, approvalMode: "all" | "per_step") => void;
  approvePlan: (planId: string) => void;
  approveStep: (planId: string, stepId: string) => void;
  retryStep: (planId: string, stepId: string) => void;
  skipStep: (planId: string, stepId: string) => void;
  amendSteps: (planId: string, steps: PlanStepDraft[]) => void;
  pausePlan: () => void;
  resumePlan: () => void;
  resumeAuto: () => void;
  cancelPlan: () => void;
  resetPlan: () => void;
}

export function usePlanning(
  wsRef: React.MutableRefObject<WebSocket | null>,
  subscribe: Subscribe,
): UsePlanningReturn {
  const [plan, setPlan] = useState<EpistemePlan | null>(null);

  const send = useCallback((msg: unknown) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, [wsRef]);

  useEffect(() => {
    const unsubCreated = subscribe("plan_created", (msg) => setPlan(msg.plan));
    const unsubUpdated = subscribe("plan_updated", (msg) => setPlan(msg.plan));
    const unsubStepStarted = subscribe("plan_step_started", (msg) => {
      setPlan(prev => {
        if (!prev || prev.id !== msg.planId) return prev;
        return {
          ...prev,
          steps: prev.steps.map(s =>
            s.id === msg.stepId ? { ...s, state: "running" } : s,
          ),
        };
      });
    });
    const unsubStepCompleted = subscribe("plan_step_completed", (msg) => {
      setPlan(prev => {
        if (!prev || prev.id !== msg.planId) return prev;
        return {
          ...prev,
          steps: prev.steps.map(s =>
            s.id === msg.stepId ? { ...s, state: "complete", contextSummary: msg.summary } : s,
          ),
        };
      });
    });
    const unsubStepFailed = subscribe("plan_step_failed", (msg) => {
      setPlan(prev => {
        if (!prev || prev.id !== msg.planId) return prev;
        return {
          ...prev,
          state: "step_failed",
          steps: prev.steps.map(s =>
            s.id === msg.stepId ? { ...s, state: "failed", error: msg.error } : s,
          ),
        };
      });
    });
    const unsubComplete = subscribe("plan_complete", (msg) => {
      setPlan(prev => {
        if (!prev || prev.id !== msg.planId) return prev;
        return { ...prev, state: "complete" };
      });
    });

    return () => {
      unsubCreated();
      unsubUpdated();
      unsubStepStarted();
      unsubStepCompleted();
      unsubStepFailed();
      unsubComplete();
    };
  }, [subscribe]);

  const requestPlan = useCallback((goal: string, approvalMode: "all" | "per_step") => {
    send({ type: "plan_request", goal, approvalMode });
  }, [send]);

  const requestPlanFromDocument = useCallback((path: string, goal: string, approvalMode: "all" | "per_step") => {
    send({ type: "plan_from_document", path, goal, approvalMode });
  }, [send]);

  const approvePlan = useCallback((planId: string) => {
    send({ type: "plan_approve", planId });
  }, [send]);

  const approveStep = useCallback((planId: string, stepId: string) => {
    send({ type: "plan_approve_step", planId, stepId });
  }, [send]);

  const retryStep = useCallback((planId: string, stepId: string) => {
    send({ type: "plan_retry_step", planId, stepId });
  }, [send]);

  const skipStep = useCallback((planId: string, stepId: string) => {
    send({ type: "plan_skip_step", planId, stepId });
  }, [send]);

  const amendSteps = useCallback((planId: string, steps: PlanStepDraft[]) => {
    send({ type: "plan_amend_steps", planId, steps });
  }, [send]);

  const pausePlan = useCallback(() => {
    send({ type: "plan_pause" });
  }, [send]);

  const resumePlan = useCallback(() => {
    send({ type: "plan_resume" });
  }, [send]);

  const cancelPlan = useCallback(() => {
    send({ type: "plan_cancel" });
  }, [send]);

  const resumeAuto = useCallback(() => {
    send({ type: "plan_resume_auto" });
  }, [send]);

  const resetPlan = useCallback(() => {
    setPlan(null);
  }, []);

  return {
    plan,
    requestPlan,
    requestPlanFromDocument,
    approvePlan,
    approveStep,
    retryStep,
    skipStep,
    amendSteps,
    pausePlan,
    resumePlan,
    resumeAuto,
    cancelPlan,
    resetPlan,
  };
}
