import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "../../../primitives/Button.tsx";
import { Icon } from "../../../primitives/Icon.tsx";
import { Select } from "../../../primitives/Select.tsx";
import { Spinner } from "../../../primitives/Spinner.tsx";
import { Textarea } from "../../../primitives/Textarea.tsx";
import type { EpistemePlanStep } from "../../../../planning/types.ts";

interface AddStepFormProps {
  isLoading: boolean;
  existingSteps: ReadonlyArray<EpistemePlanStep>;
  defaultInsertAfterStepId?: string | null;
  onAdd: (description: string, insertAfterStepId?: string | null) => void;
  onCancel: () => void;
}

const START_VALUE = "__start__";

export function AddStepForm({
  isLoading,
  existingSteps,
  defaultInsertAfterStepId,
  onAdd,
  onCancel,
}: AddStepFormProps) {
  const [description, setDescription] = useState("");
  const fallbackPosition = existingSteps.length > 0 ? existingSteps[existingSteps.length - 1]!.id : null;
  const [insertAfterStepId, setInsertAfterStepId] = useState<string | null>(
    defaultInsertAfterStepId !== undefined ? defaultInsertAfterStepId : fallbackPosition,
  );

  const handleSubmit = () => {
    if (!description.trim() || isLoading) return;
    onAdd(description.trim(), insertAfterStepId);
  };

  const positionOptions = [
    { value: START_VALUE, label: "At the beginning" },
    ...existingSteps.map((s, i) => ({
      value: s.id,
      label: `After step ${i + 1}: ${s.title.length > 30 ? s.title.slice(0, 30) + "…" : s.title}`,
    })),
  ];

  return (
    <div className="plan-add-step-form">
      {existingSteps.length > 1 && (
        <Select
          className="plan-add-step-position"
          value={insertAfterStepId ?? START_VALUE}
          onChange={(v) => setInsertAfterStepId(v === START_VALUE ? null : v)}
          disabled={isLoading}
          options={positionOptions}
        />
      )}
      <Textarea
        className="plan-editor-instruction-input"
        placeholder="Describe the step to add…"
        value={description}
        rows={2}
        autoFocus
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="plan-add-step-actions">
        <Button
          size="sm"
          variant="solid"
          onClick={handleSubmit}
          disabled={!description.trim() || isLoading}
          iconLeft={isLoading ? <Spinner size="xs" /> : <Icon icon={Plus} size="xs" />}
        >
          {isLoading ? "Adding…" : "Add step"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
