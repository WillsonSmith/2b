import { useState } from "react";
import { Button } from "../../../primitives/Button.tsx";
import { Input } from "../../../primitives/Input.tsx";
import { Select } from "../../../primitives/Select.tsx";
import { Textarea } from "../../../primitives/Textarea.tsx";
import { STEP_TYPE_LABELS, ALL_STEP_TYPES } from "../planStepIcons.tsx";
import type { EpistemePlanStep, EpistemePlanStepType, PlanStepDraft } from "../../../../planning/types.ts";

interface PlanStepEditorProps {
  steps: ReadonlyArray<EpistemePlanStep>;
  onSave: (drafts: PlanStepDraft[]) => void;
  onCancel: () => void;
}

const TYPE_OPTIONS = ALL_STEP_TYPES.map((t) => ({ value: t, label: STEP_TYPE_LABELS[t] }));

export function PlanStepEditor({ steps, onSave, onCancel }: PlanStepEditorProps) {
  const [drafts, setDrafts] = useState<PlanStepDraft[]>(
    steps.map((s) => ({ type: s.type, title: s.title, instruction: s.instruction })),
  );

  const update = (i: number, field: keyof PlanStepDraft, value: string) => {
    setDrafts((prev) =>
      prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)),
    );
  };

  return (
    <div className="plan-editor">
      <div className="plan-editor-steps">
        {drafts.map((d, i) => (
          <div key={i} className="plan-editor-step">
            <div className="plan-editor-step-row">
              <span className="plan-step-num">{i + 1}</span>
              <Select
                className="plan-editor-type-select"
                value={d.type}
                onChange={(v) => update(i, "type", v as EpistemePlanStepType)}
                options={TYPE_OPTIONS}
              />
              <Input
                className="plan-editor-title-input"
                value={d.title}
                placeholder="Step title"
                onChange={(e) => update(i, "title", e.target.value)}
              />
            </div>
            <Textarea
              className="plan-editor-instruction-input"
              value={d.instruction}
              rows={2}
              placeholder="Step instruction"
              onChange={(e) => update(i, "instruction", e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="plan-editor-actions">
        <Button variant="solid" onClick={() => onSave(drafts)}>
          Save changes
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
