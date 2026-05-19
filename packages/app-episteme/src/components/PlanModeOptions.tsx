import type { PlanApprovalMode } from "../planning/types.ts";

interface PlanModeOptionsProps {
  approvalMode: PlanApprovalMode;
  onApprovalModeChange: (mode: PlanApprovalMode) => void;
  useDocument: boolean;
  onUseDocumentChange: (useDocument: boolean) => void;
  activeFile: string | null | undefined;
  radioGroupName: string;
  wrapperClassName: string;
  labelClassName: string;
  withSpans?: boolean;
}

export function PlanModeOptions({
  approvalMode,
  onApprovalModeChange,
  useDocument,
  onUseDocumentChange,
  activeFile,
  radioGroupName,
  wrapperClassName,
  labelClassName,
  withSpans = true,
}: PlanModeOptionsProps) {
  const wrap = (text: string) => (withSpans ? <span>{text}</span> : text);

  return (
    <div className={wrapperClassName}>
      <label className={labelClassName}>
        <input
          type="radio"
          name={radioGroupName}
          value="all"
          checked={approvalMode === "all"}
          onChange={() => onApprovalModeChange("all")}
        />
        {wrap("Approve all at once")}
      </label>
      <label className={labelClassName}>
        <input
          type="radio"
          name={radioGroupName}
          value="per_step"
          checked={approvalMode === "per_step"}
          onChange={() => onApprovalModeChange("per_step")}
        />
        {wrap("Approve step-by-step")}
      </label>
      {activeFile && (
        <label className={labelClassName}>
          <input
            type="checkbox"
            checked={useDocument}
            onChange={(e) => onUseDocumentChange(e.target.checked)}
          />
          {wrap("Plan from current document")}
        </label>
      )}
    </div>
  );
}
