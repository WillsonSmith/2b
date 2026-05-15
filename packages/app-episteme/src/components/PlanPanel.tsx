import { X } from "lucide-react";
import type { WsPlan, WsPlanStep } from "../protocol.ts";

interface PlanPanelProps {
  plan: WsPlan | null;
  onClose: () => void;
}

const STATUS_LABELS: Record<WsPlanStep["status"], string> = {
  pending: "pending",
  in_progress: "in progress",
  done: "done",
  failed: "failed",
  skipped: "skipped",
};

function formatData(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function PlanPanel({ plan, onClose }: PlanPanelProps) {
  return (
    <div className="plan-panel">
      <div className="plan-panel-header">
        <span className="plan-panel-title">Plan</span>
        {plan && (
          <span className={`plan-status-badge plan-status-${plan.status}`}>
            {plan.status}
          </span>
        )}
        <button className="header-icon-btn" onClick={onClose} title="Close">
          <X size={13} />
        </button>
      </div>

      <div className="plan-content">
        {!plan ? (
          <div className="plan-empty">No active plan.</div>
        ) : (
          <>
            <div className="plan-goal">{plan.goal}</div>
            <ol className="plan-steps">
              {plan.steps.map((step) => (
                <li key={step.id} className={`plan-step plan-step-${step.status}`}>
                  <div className="plan-step-row">
                    <span className="plan-step-num">{step.position + 1}</span>
                    <span className={`plan-step-badge plan-step-badge-${step.status}`}>
                      {STATUS_LABELS[step.status]}
                    </span>
                    <span className="plan-step-desc">{step.description}</span>
                  </div>
                  {step.notes && (
                    <div className="plan-step-notes">{step.notes}</div>
                  )}
                  {step.data && (
                    <pre className="plan-step-data">{formatData(step.data)}</pre>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
