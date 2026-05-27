import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "../../../primitives/Button.tsx";
import { Icon } from "../../../primitives/Icon.tsx";
import { Textarea } from "../../../primitives/Textarea.tsx";

interface PlanStepInstructionEditorProps {
  initial: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}

export function PlanStepInstructionEditor({ initial, onSave, onCancel }: PlanStepInstructionEditorProps) {
  const [draft, setDraft] = useState(initial);

  const save = () => onSave(draft.trim());

  return (
    <>
      <Textarea
        className="plan-editor-instruction-input"
        value={draft}
        rows={3}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="plan-step-summary-edit-actions">
        <Button
          size="sm"
          variant="solid"
          onClick={save}
          iconLeft={<Icon icon={Check} size="xs" />}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}
