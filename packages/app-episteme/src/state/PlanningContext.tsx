import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { signal, useConstant, type Signal } from "./signals.ts";
import type { EpistemePlan, PlanStepDraft } from "../planning/types.ts";
import type { UsePlanningReturn } from "../hooks/usePlanning.ts";

type ApprovalMode = "all" | "per_step";

export interface PlanningContextValue {
  plan: Signal<EpistemePlan | null>;

  requestPlan: (goal: string, approvalMode: ApprovalMode, previousPlanId?: string) => void;
  requestPlanFromDocument: (
    path: string,
    goal: string,
    approvalMode: ApprovalMode,
    previousPlanId?: string,
  ) => void;
  approvePlan: (planId: string) => void;
  approveStep: (planId: string, stepId: string) => void;
  retryStep: (planId: string, stepId: string) => void;
  skipStep: (planId: string, stepId: string) => void;
  amendSteps: (planId: string, steps: PlanStepDraft[]) => void;
  editStepSummary: (planId: string, stepId: string, summary: string) => void;
  editStepInstruction: (planId: string, stepId: string, instruction: string) => void;
  addStep: (planId: string, description: string, insertAfterStepId?: string | null) => void;
  reorderStep: (planId: string, stepId: string, direction: "up" | "down") => void;
  pausePlan: () => void;
  resumePlan: () => void;
  resumeAuto: () => void;
  cancelPlan: () => void;
  resetPlan: () => void;
}

const Ctx = createContext<PlanningContextValue | null>(null);

export function usePlanningCtx(): PlanningContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlanningCtx must be used inside <PlanningProvider>");
  return v;
}

interface PlanningProviderProps {
  planning: UsePlanningReturn;
  children: ReactNode;
}

export function PlanningProvider({ planning, children }: PlanningProviderProps) {
  const pRef = useRef(planning);
  pRef.current = planning;

  const value = useConstant<PlanningContextValue>(() => {
    const plan = signal<EpistemePlan | null>(null);

    return {
      plan,
      requestPlan: () => {},
      requestPlanFromDocument: () => {},
      approvePlan: () => {},
      approveStep: () => {},
      retryStep: () => {},
      skipStep: () => {},
      amendSteps: () => {},
      editStepSummary: () => {},
      editStepInstruction: () => {},
      addStep: () => {},
      reorderStep: () => {},
      pausePlan: () => {},
      resumePlan: () => {},
      resumeAuto: () => {},
      cancelPlan: () => {},
      resetPlan: () => {},
    };
  });

  useEffect(() => {
    value.requestPlan = (g, a, prev) => pRef.current.requestPlan(g, a, prev);
    value.requestPlanFromDocument = (p, g, a, prev) => pRef.current.requestPlanFromDocument(p, g, a, prev);
    value.approvePlan = (id) => pRef.current.approvePlan(id);
    value.approveStep = (pid, sid) => pRef.current.approveStep(pid, sid);
    value.retryStep = (pid, sid) => pRef.current.retryStep(pid, sid);
    value.skipStep = (pid, sid) => pRef.current.skipStep(pid, sid);
    value.amendSteps = (pid, steps) => pRef.current.amendSteps(pid, steps);
    value.editStepSummary = (pid, sid, s) => pRef.current.editStepSummary(pid, sid, s);
    value.editStepInstruction = (pid, sid, i) => pRef.current.editStepInstruction(pid, sid, i);
    value.addStep = (pid, desc, after) => pRef.current.addStep(pid, desc, after);
    value.reorderStep = (pid, sid, dir) => pRef.current.reorderStep(pid, sid, dir);
    value.pausePlan = () => pRef.current.pausePlan();
    value.resumePlan = () => pRef.current.resumePlan();
    value.resumeAuto = () => pRef.current.resumeAuto();
    value.cancelPlan = () => pRef.current.cancelPlan();
    value.resetPlan = () => pRef.current.resetPlan();
  }, [value]);

  useEffect(() => {
    value.plan.value = planning.plan;
  });

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
