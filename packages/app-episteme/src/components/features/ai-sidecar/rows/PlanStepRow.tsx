import type { ReactNode } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import { Spinner } from "../../../primitives/Spinner.tsx";
import { Disclosure } from "../../../composites/Disclosure.tsx";
import { PLAN_STEP_TYPE_ICONS } from "../planStepIcons.tsx";
import type { SidecarMessage } from "../types.ts";

interface PlanStepRowProps {
  message: Extract<SidecarMessage, { role: "plan_step" }>;
}

function stateIcon(state: "running" | "complete" | "failed"): ReactNode {
  switch (state) {
    case "running":
      return <Spinner size="xs" />;
    case "complete":
      return <Icon icon={CheckCircle2} size="xs" className="ep-sidecar__plan-step-done" />;
    case "failed":
      return <Icon icon={AlertCircle} size="xs" className="ep-sidecar__plan-step-fail" />;
  }
}

export function PlanStepRow({ message }: PlanStepRowProps) {
  const TypeIcon = PLAN_STEP_TYPE_ICONS[message.stepType];
  const isExpandable = !!(message.summary || message.error);
  const className = `ep-sidecar__plan-step ep-sidecar__plan-step--${message.state}`;

  const summary = (
    <>
      <span className="ep-sidecar__plan-step-state">{stateIcon(message.state)}</span>
      <span className="ep-sidecar__plan-step-type-icon"><TypeIcon /></span>
      <span className="ep-sidecar__plan-step-title">{message.stepTitle}</span>
      <span className="ep-sidecar__plan-step-type">{message.stepType}</span>
    </>
  );

  if (!isExpandable) {
    return <div className={className}>{summary}</div>;
  }

  return (
    <Disclosure className={className} summary={summary}>
      {message.error ? (
        <span className="ep-sidecar__plan-step-error">{message.error}</span>
      ) : (
        <span className="ep-sidecar__plan-step-result">{message.summary}</span>
      )}
    </Disclosure>
  );
}
