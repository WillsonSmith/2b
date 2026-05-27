import { useEffect, useState, type FormEvent } from "react";
import { X, ClipboardList } from "lucide-react";
import { Button } from "../../primitives/Button.tsx";
import { Icon } from "../../primitives/Icon.tsx";
import { IconButton } from "../../primitives/IconButton.tsx";
import { Textarea } from "../../primitives/Textarea.tsx";
import { PlanModeOptions } from "../../PlanModeOptions.tsx";
import type { PlanApprovalMode } from "../../../planning/types.ts";

interface PlanRequestFormProps {
  activeFile: string | null;
  followingUp?: { id: string; goal: string } | null;
  onClearFollowup?: () => void;
  onRequest: (goal: string, approvalMode: PlanApprovalMode, previousPlanId?: string) => void;
  onRequestFromDocument: (path: string, goal: string, approvalMode: PlanApprovalMode, previousPlanId?: string) => void;
  seedGoal?: string;
  onSeedConsumed?: () => void;
}

export function PlanRequestForm({
  activeFile,
  followingUp,
  onClearFollowup,
  onRequest,
  onRequestFromDocument,
  seedGoal,
  onSeedConsumed,
}: PlanRequestFormProps) {
  const [goal, setGoal] = useState(seedGoal ?? "");
  const [approvalMode, setApprovalMode] = useState<PlanApprovalMode>("per_step");
  const [useDocument, setUseDocument] = useState(false);

  useEffect(() => {
    if (seedGoal) setGoal(seedGoal);
  }, [seedGoal]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) return;
    const prevId = followingUp?.id;
    if (useDocument && activeFile) {
      onRequestFromDocument(activeFile, goal.trim(), approvalMode, prevId);
    } else {
      onRequest(goal.trim(), approvalMode, prevId);
    }
    setGoal("");
    onSeedConsumed?.();
  };

  return (
    <form className="plan-request-form" onSubmit={handleSubmit}>
      {followingUp && (
        <div className="plan-followup-badge">
          <span>Following up: <em>{followingUp.goal}</em></span>
          <IconButton
            size="sm"
            icon={<Icon icon={X} size="xs" />}
            aria-label="Start a fresh plan instead"
            onClick={onClearFollowup}
          />
        </div>
      )}
      <Textarea
        className="plan-request-textarea"
        placeholder={followingUp ? "What do you want to do next?" : "Describe what you want to accomplish…"}
        value={goal}
        rows={3}
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(e);
        }}
      />
      <PlanModeOptions
        approvalMode={approvalMode}
        onApprovalModeChange={setApprovalMode}
        useDocument={useDocument}
        onUseDocumentChange={setUseDocument}
        activeFile={activeFile}
        radioGroupName="approvalMode"
        wrapperClassName="plan-request-options"
        labelClassName="plan-request-label"
      />
      <Button
        type="submit"
        variant="solid"
        disabled={!goal.trim()}
        className="plan-btn--full"
        iconLeft={<Icon icon={ClipboardList} size="sm" />}
      >
        {followingUp ? "Create follow-up plan" : "Create plan"}
      </Button>
    </form>
  );
}
