import { useState } from "react";
import { Button } from "../../primitives/Button.tsx";
import { Textarea } from "../../primitives/Textarea.tsx";
import { useAI } from "../../../state/AIContext.tsx";
import { useSignalValue } from "../../../state/signals.ts";

interface FollowUpComposerProps {
  onClose: () => void;
}

export function FollowUpComposer({ onClose }: FollowUpComposerProps) {
  const ai = useAI();
  const activePlan = useSignalValue(ai.activePlan);
  const [goal, setGoal] = useState("");

  const submit = () => {
    const trimmed = goal.trim();
    if (!trimmed) return;
    if (activePlan) ai.planFollowUp(trimmed, activePlan.id, "per_step");
    else ai.planRequest(trimmed, "per_step");
    setGoal("");
    onClose();
  };

  return (
    <div className="ep-sidecar__followup-composer">
      {activePlan ? (
        <div className="ep-sidecar__followup-context">
          Following up: <em>{activePlan.goal}</em>
        </div>
      ) : (
        <div className="ep-sidecar__followup-warn">
          No prior plan — this will start a fresh plan.
        </div>
      )}
      <Textarea
        autoFocus
        rows={2}
        autosize
        maxAutosizeRows={6}
        placeholder="What do you want to do next?"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          if (e.key === "Escape") onClose();
        }}
      />
      <div className="ep-sidecar__followup-actions">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="solid" onClick={submit} disabled={!goal.trim()}>
          {activePlan ? "Create follow-up" : "Create plan"}
        </Button>
      </div>
    </div>
  );
}
