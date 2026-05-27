import { useEffect, useRef, useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "../../primitives/Button.tsx";
import { Icon } from "../../primitives/Icon.tsx";
import { Spinner } from "../../primitives/Spinner.tsx";
import { MarkdownView } from "../../MarkdownView.tsx";
import { usePlanningCtx } from "../../../state/PlanningContext.tsx";
import { useFiles } from "../../../state/FileContext.tsx";
import { useUI } from "../../../state/UIContext.tsx";
import { useAI } from "../../../state/AIContext.tsx";
import { useSignalValue } from "../../../state/signals.ts";
import { PLAN_STATE_LABELS } from "./constants.ts";
import { PlanActionBar } from "./PlanActionBar.tsx";
import { PlanRequestForm } from "./PlanRequestForm.tsx";
import { PlanStepEditor } from "./steps/PlanStepEditor.tsx";
import { PlanStepRow } from "./steps/PlanStepRow.tsx";
import { AddStepForm } from "./steps/AddStepForm.tsx";

export function PlanPanel() {
  const planning = usePlanningCtx();
  const file = useFiles();
  const ui = useUI();
  const ai = useAI();
  const plan = useSignalValue(planning.plan);
  const activeFile = useSignalValue(file.activeFile);
  const agentState = useSignalValue(ai.agentState);
  const seedGoal = useSignalValue(ui.planSeedGoal);

  const [editing, setEditing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [followingUp, setFollowingUp] = useState<{ id: string; goal: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingStep, setAddingStep] = useState(false);
  const prevStepsLenRef = useRef(plan?.steps.length ?? 0);

  useEffect(() => {
    if (plan?.state === "paused" || plan?.state === "executing") setPausing(false);
  }, [plan?.state]);

  useEffect(() => {
    if (plan?.state === "cancelled") setCancelling(false);
  }, [plan?.state]);

  useEffect(() => {
    const len = plan?.steps.length ?? 0;
    if (addingStep && len > prevStepsLenRef.current) {
      setShowAddForm(false);
      setAddingStep(false);
    }
    prevStepsLenRef.current = len;
  }, [plan?.steps.length, addingStep]);

  const currentStepId = plan?.steps.find(
    (s) => s.state === "running" || s.state === "awaiting_approval",
  )?.id;

  const doneCount = plan
    ? plan.steps.filter((s) => s.state === "complete" || s.state === "skipped").length
    : 0;
  const total = plan?.steps.length ?? 0;
  const progress = total > 0 ? (doneCount / total) * 100 : 0;

  const isStructuring = agentState === "structuring";

  const handleCancel = () => {
    setCancelling(true);
    planning.cancelPlan();
  };

  const handleNewPlan = () => planning.resetPlan();

  const handleFollowUp = () => {
    if (!plan) return;
    setFollowingUp({ id: plan.id, goal: plan.goal });
    planning.resetPlan();
  };

  return (
    <div className="plan-panel">
      <div className="plan-panel-body">
        {isStructuring && (
          <div className="plan-structuring">
            <Spinner size="md" />
            <span>Structuring plan…</span>
          </div>
        )}

        {!plan && !isStructuring && (
          <PlanRequestForm
            activeFile={activeFile}
            followingUp={followingUp}
            onClearFollowup={() => setFollowingUp(null)}
            onRequest={planning.requestPlan}
            onRequestFromDocument={planning.requestPlanFromDocument}
            seedGoal={seedGoal}
            onSeedConsumed={() => { ui.planSeedGoal.value = ""; }}
          />
        )}

        {plan && (
          <>
            <div className="plan-goal">
              <MarkdownView content={plan.goal} className="sidecar-msg-markdown" />
              <span className={`plan-state-badge plan-state-badge--${plan.state}`}>
                {PLAN_STATE_LABELS[plan.state] ?? plan.state}
              </span>
            </div>

            {plan.priorContext && (
              <details className="plan-prior-context">
                <summary className="plan-prior-context-summary">
                  <Icon icon={ChevronRight} size="xs" className="plan-prior-context-chev" />
                  Building on previous plan
                </summary>
                <pre className="plan-prior-context-body">{plan.priorContext}</pre>
              </details>
            )}

            {total > 0 && (
              <div className="plan-progress-bar">
                <div className="plan-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            )}

            {editing ? (
              <PlanStepEditor
                steps={plan.steps}
                onSave={(drafts) => {
                  planning.amendSteps(plan.id, drafts);
                  setEditing(false);
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div className="plan-steps">
                {plan.steps.map((step, i) => (
                  <PlanStepRow
                    key={step.id}
                    step={step}
                    index={i}
                    isCurrent={step.id === currentStepId}
                    isFirst={i === 0}
                    isLast={i === plan.steps.length - 1}
                    planState={plan.state}
                    planId={plan.id}
                    onApproveStep={planning.approveStep}
                    onRetry={planning.retryStep}
                    onSkip={planning.skipStep}
                    onEditSummary={planning.editStepSummary}
                    onEditInstruction={planning.editStepInstruction}
                    onMoveUp={() => planning.reorderStep(plan.id, step.id, "up")}
                    onMoveDown={() => planning.reorderStep(plan.id, step.id, "down")}
                  />
                ))}
                {(plan.state === "awaiting_approval" || plan.state === "awaiting_step") &&
                  (showAddForm ? (
                    <AddStepForm
                      isLoading={addingStep}
                      existingSteps={plan.steps}
                      defaultInsertAfterStepId={
                        plan.state === "awaiting_step" ? currentStepId : undefined
                      }
                      onAdd={(desc, insertAfterStepId) => {
                        setAddingStep(true);
                        planning.addStep(plan.id, desc, insertAfterStepId);
                      }}
                      onCancel={() => {
                        setShowAddForm(false);
                        setAddingStep(false);
                      }}
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="plan-add-step-btn"
                      onClick={() => setShowAddForm(true)}
                      iconLeft={<Icon icon={Plus} size="xs" />}
                    >
                      Add step
                    </Button>
                  ))}
              </div>
            )}
          </>
        )}
      </div>

      {plan && (
        <div className="plan-actions">
          <PlanActionBar
            plan={plan}
            doneCount={doneCount}
            total={total}
            pausing={pausing}
            cancelling={cancelling}
            editing={editing}
            onApprovePlan={() => planning.approvePlan(plan.id)}
            onEditSteps={() => setEditing(true)}
            onPause={() => {
              setPausing(true);
              planning.pausePlan();
            }}
            onResume={planning.resumePlan}
            onResumeAuto={planning.resumeAuto}
            onCancel={handleCancel}
            onNewPlan={handleNewPlan}
            onFollowUp={handleFollowUp}
          />
        </div>
      )}
    </div>
  );
}
