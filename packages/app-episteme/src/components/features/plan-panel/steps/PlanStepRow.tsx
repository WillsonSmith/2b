import { useState, type MouseEvent } from "react";
import {
  Play, SkipForward, RotateCcw, ChevronDown, ChevronRight, ChevronUp,
  CheckCircle2, AlertCircle, Circle, PencilLine,
} from "lucide-react";
import { Button } from "../../../primitives/Button.tsx";
import { Icon } from "../../../primitives/Icon.tsx";
import { IconButton } from "../../../primitives/IconButton.tsx";
import { Spinner } from "../../../primitives/Spinner.tsx";
import { STEP_TYPE_ICONS, STEP_TYPE_LABELS } from "../planStepIcons.tsx";
import { PlanStepSummaryEditor } from "./PlanStepSummaryEditor.tsx";
import { PlanStepInstructionEditor } from "./PlanStepInstructionEditor.tsx";
import type { EpistemePlan, EpistemePlanStep } from "../../../../planning/types.ts";

interface PlanStepRowProps {
  step: EpistemePlanStep;
  index: number;
  isCurrent: boolean;
  isFirst: boolean;
  isLast: boolean;
  planState: EpistemePlan["state"];
  planId: string;
  onApproveStep: (planId: string, stepId: string) => void;
  onRetry: (planId: string, stepId: string) => void;
  onSkip: (planId: string, stepId: string) => void;
  onEditSummary: (planId: string, stepId: string, summary: string) => void;
  onEditInstruction: (planId: string, stepId: string, instruction: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function PlanStepRow({
  step,
  index,
  isCurrent,
  isFirst,
  isLast,
  planState,
  planId,
  onApproveStep,
  onRetry,
  onSkip,
  onEditSummary,
  onEditInstruction,
  onMoveUp,
  onMoveDown,
}: PlanStepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [editingInstruction, setEditingInstruction] = useState(false);
  const TypeIcon = STEP_TYPE_ICONS[step.type];

  const stateIcon = () => {
    switch (step.state) {
      case "running":            return <Spinner size="sm" className="plan-step-icon-spin" />;
      case "complete":           return <Icon icon={CheckCircle2} size="sm" className="plan-step-icon-done" />;
      case "failed":             return <Icon icon={AlertCircle} size="sm" className="plan-step-icon-fail" />;
      case "skipped":            return <Icon icon={SkipForward} size="sm" className="plan-step-icon-skip" />;
      case "awaiting_approval":  return <Icon icon={Play} size="sm" className="plan-step-icon-pending" />;
      default:                   return <Icon icon={Circle} size="sm" className="plan-step-icon-pending" />;
    }
  };

  const isExpandable =
    !!step.instruction ||
    (step.state === "complete" && !!(step.contextSummary || step.fullResult));

  const startEditing = (e: MouseEvent) => {
    e.stopPropagation();
    setEditingSummary(true);
  };

  const className = [
    "plan-step",
    isCurrent && "plan-step--current",
    step.state === "failed" && "plan-step--failed",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <div className="plan-step-header" onClick={() => isExpandable && setExpanded((v) => !v)}>
        <span className="plan-step-num">{index + 1}</span>
        <span className="plan-step-state-icon">{stateIcon()}</span>
        <span className="plan-step-type-icon"><TypeIcon size={13} /></span>
        <span className="plan-step-title">{step.title}</span>
        <span className="plan-step-type-label">{STEP_TYPE_LABELS[step.type]}</span>
        {planState === "awaiting_approval" && (
          <span className="plan-step-reorder-btns" onClick={(e) => e.stopPropagation()}>
            <IconButton
              size="sm"
              icon={<Icon icon={ChevronUp} size="xs" />}
              aria-label="Move up"
              onClick={onMoveUp}
              disabled={isFirst}
            />
            <IconButton
              size="sm"
              icon={<Icon icon={ChevronDown} size="xs" />}
              aria-label="Move down"
              onClick={onMoveDown}
              disabled={isLast}
            />
          </span>
        )}
        {isExpandable && (
          <span className="plan-step-expand-icon">
            <Icon icon={expanded ? ChevronDown : ChevronRight} size="xs" />
          </span>
        )}
      </div>

      {expanded && (
        <div className="plan-step-summary">
          {step.state === "complete" && step.contextSummary ? (
            editingSummary ? (
              <PlanStepSummaryEditor
                initial={step.contextSummary}
                onSave={(value) => {
                  onEditSummary(planId, step.id, value);
                  setEditingSummary(false);
                }}
                onCancel={() => setEditingSummary(false)}
              />
            ) : (
              <div className="plan-step-summary-text">
                <span>{step.contextSummary}</span>
                <button
                  className="plan-step-summary-edit-btn"
                  onClick={startEditing}
                  title="Edit context summary"
                  type="button"
                >
                  <Icon icon={PencilLine} size="xs" />
                </button>
              </div>
            )
          ) : (
            <p className="plan-step-instruction-preview">{step.instruction}</p>
          )}
        </div>
      )}

      {step.state === "failed" && step.error && (
        <div className="plan-step-error">
          <span className="plan-step-error-text">{step.error}</span>
          {planState === "step_failed" && (
            <div className="plan-step-error-actions">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRetry(planId, step.id)}
                iconLeft={<Icon icon={RotateCcw} size="xs" />}
              >
                Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onSkip(planId, step.id)}
                iconLeft={<Icon icon={SkipForward} size="xs" />}
              >
                Skip
              </Button>
            </div>
          )}
        </div>
      )}

      {step.state === "awaiting_approval" && planState === "awaiting_step" && (
        <div className="plan-step-approve">
          {editingInstruction ? (
            <PlanStepInstructionEditor
              initial={step.instruction}
              onSave={(value) => {
                onEditInstruction(planId, step.id, value);
                setEditingInstruction(false);
              }}
              onCancel={() => setEditingInstruction(false)}
            />
          ) : (
            <div className="plan-step-summary-text">
              <span className="plan-step-instruction-preview">{step.instruction}</span>
              <button
                className="plan-step-summary-edit-btn"
                onClick={() => setEditingInstruction(true)}
                title="Edit instruction"
                type="button"
              >
                <Icon icon={PencilLine} size="xs" />
              </button>
            </div>
          )}
          <Button
            variant="solid"
            onClick={() => onApproveStep(planId, step.id)}
            iconLeft={<Icon icon={Play} size="sm" />}
          >
            Run this step
          </Button>
        </div>
      )}
    </div>
  );
}
