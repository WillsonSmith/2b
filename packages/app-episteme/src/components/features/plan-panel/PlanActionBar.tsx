import { Play, Pause, Ban, CheckCircle2, ClipboardList } from "lucide-react";
import { Button } from "../../primitives/Button.tsx";
import { Icon } from "../../primitives/Icon.tsx";
import { Spinner } from "../../primitives/Spinner.tsx";
import type { EpistemePlan } from "../../../planning/types.ts";

interface PlanActionBarProps {
  plan: EpistemePlan;
  doneCount: number;
  total: number;
  pausing: boolean;
  cancelling: boolean;
  editing: boolean;
  onApprovePlan: () => void;
  onEditSteps: () => void;
  onPause: () => void;
  onResume: () => void;
  onResumeAuto: () => void;
  onCancel: () => void;
  onNewPlan: () => void;
  onFollowUp: () => void;
}

export function PlanActionBar({
  plan,
  doneCount,
  total,
  pausing,
  cancelling,
  editing,
  onApprovePlan,
  onEditSteps,
  onPause,
  onResume,
  onResumeAuto,
  onCancel,
  onNewPlan,
  onFollowUp,
}: PlanActionBarProps) {
  if (cancelling) {
    return (
      <span className="plan-cancelling-message">
        <Spinner size="sm" /> Cancelling…
      </span>
    );
  }

  switch (plan.state) {
    case "awaiting_approval":
      return (
        <>
          <Button variant="solid" onClick={onApprovePlan} iconLeft={<Icon icon={Play} size="sm" />}>
            Start plan
          </Button>
          {!editing && (
            <Button variant="ghost" onClick={onEditSteps}>
              Edit steps
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel} iconLeft={<Icon icon={Ban} size="sm" />}>
            Cancel
          </Button>
        </>
      );

    case "executing":
      return (
        <>
          <Button
            variant="ghost"
            onClick={onPause}
            disabled={pausing}
            iconLeft={pausing ? <Spinner size="sm" /> : <Icon icon={Pause} size="sm" />}
          >
            {pausing ? "Pausing…" : "Pause after step"}
          </Button>
          <Button variant="ghost" onClick={onCancel} iconLeft={<Icon icon={Ban} size="sm" />}>
            Cancel
          </Button>
        </>
      );

    case "awaiting_step":
      return (
        <>
          <Button size="sm" variant="ghost" onClick={onResumeAuto}>
            Run all remaining
          </Button>
          <Button variant="ghost" onClick={onCancel} iconLeft={<Icon icon={Ban} size="sm" />}>
            Cancel
          </Button>
        </>
      );

    case "paused":
      return (
        <>
          <Button variant="solid" onClick={onResume} iconLeft={<Icon icon={Play} size="sm" />}>
            Resume
          </Button>
          {plan.approvalMode === "per_step" && (
            <Button variant="ghost" onClick={onResumeAuto}>
              Run all remaining
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel} iconLeft={<Icon icon={Ban} size="sm" />}>
            Cancel
          </Button>
        </>
      );

    case "step_failed":
      return (
        <Button variant="ghost" onClick={onCancel} iconLeft={<Icon icon={Ban} size="sm" />}>
          Cancel plan
        </Button>
      );

    case "complete":
      return (
        <>
          <span className="plan-complete-message">
            <Icon icon={CheckCircle2} size="sm" /> Complete ({doneCount}/{total} steps)
          </span>
          <Button size="sm" variant="solid" onClick={onFollowUp}>
            Follow-up plan
          </Button>
          <Button size="sm" variant="ghost" onClick={onNewPlan}>
            New plan
          </Button>
        </>
      );

    case "cancelled":
      return (
        <Button variant="ghost" onClick={onNewPlan} iconLeft={<Icon icon={ClipboardList} size="sm" />}>
          New plan
        </Button>
      );

    default:
      return null;
  }
}
