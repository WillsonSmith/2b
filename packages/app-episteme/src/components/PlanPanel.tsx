import { useEffect, useRef, useState } from "react";
import {
  X, Play, Pause, SkipForward, RotateCcw, Ban,
  Search, List, PenLine, Pencil, Quote, BarChart2, FolderOpen,
  ChevronDown, ChevronRight, ChevronUp, Plus, Loader2, CheckCircle2, AlertCircle, Circle,
  ClipboardList, PencilLine, Check,
} from "lucide-react";
import type { EpistemePlan, EpistemePlanStep, EpistemePlanStepType, PlanStepDraft, PlanApprovalMode } from "../planning/types.ts";

// ── Icons per step type ───────────────────────────────────────────────────────

const STEP_TYPE_ICONS: Record<EpistemePlanStepType, React.FC<{ size?: number; className?: string }>> = {
  research:  ({ size = 14, className }) => <Search size={size} className={className} />,
  outline:   ({ size = 14, className }) => <List size={size} className={className} />,
  draft:     ({ size = 14, className }) => <PenLine size={size} className={className} />,
  edit:      ({ size = 14, className }) => <Pencil size={size} className={className} />,
  cite:      ({ size = 14, className }) => <Quote size={size} className={className} />,
  analyze:   ({ size = 14, className }) => <BarChart2 size={size} className={className} />,
  organize:  ({ size = 14, className }) => <FolderOpen size={size} className={className} />,
};

const STEP_TYPE_LABELS: Record<EpistemePlanStepType, string> = {
  research: "Research",
  outline:  "Outline",
  draft:    "Draft",
  edit:     "Edit",
  cite:     "Cite",
  analyze:  "Analyze",
  organize: "Organize",
};

const ALL_STEP_TYPES: EpistemePlanStepType[] = [
  "research", "outline", "draft", "edit", "cite", "analyze", "organize",
];

// ── Step row ──────────────────────────────────────────────────────────────────

interface StepRowProps {
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

function StepRow({ step, index, isCurrent, isFirst, isLast, planState, planId, onApproveStep, onRetry, onSkip, onEditSummary, onEditInstruction, onMoveUp, onMoveDown }: StepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [editingInstruction, setEditingInstruction] = useState(false);
  const [instructionDraft, setInstructionDraft] = useState("");
  const Icon = STEP_TYPE_ICONS[step.type];

  const stateIcon = () => {
    switch (step.state) {
      case "running":         return <Loader2 size={14} className="plan-step-icon-spin" />;
      case "complete":        return <CheckCircle2 size={14} className="plan-step-icon-done" />;
      case "failed":          return <AlertCircle size={14} className="plan-step-icon-fail" />;
      case "skipped":         return <SkipForward size={14} className="plan-step-icon-skip" />;
      case "awaiting_approval": return <Play size={14} className="plan-step-icon-pending" />;
      default:                return <Circle size={14} className="plan-step-icon-pending" />;
    }
  };

  const isExpandable = !!(step.instruction) || (step.state === "complete" && !!(step.contextSummary || step.fullResult));

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSummaryDraft(step.contextSummary ?? "");
    setEditingSummary(true);
  };

  const saveSummary = () => {
    onEditSummary(planId, step.id, summaryDraft.trim());
    setEditingSummary(false);
  };

  const cancelEditing = () => setEditingSummary(false);

  return (
    <div className={`plan-step${isCurrent ? " plan-step--current" : ""}${step.state === "failed" ? " plan-step--failed" : ""}`}>
      <div className="plan-step-header" onClick={() => isExpandable && setExpanded(e => !e)}>
        <span className="plan-step-num">{index + 1}</span>
        <span className="plan-step-state-icon">{stateIcon()}</span>
        <span className="plan-step-type-icon"><Icon size={13} /></span>
        <span className="plan-step-title">{step.title}</span>
        <span className="plan-step-type-label">{STEP_TYPE_LABELS[step.type]}</span>
        {planState === "awaiting_approval" && (
          <span className="plan-step-reorder-btns" onClick={e => e.stopPropagation()}>
            <button className="plan-step-reorder-btn" onClick={onMoveUp} disabled={isFirst} title="Move up">
              <ChevronUp size={11} />
            </button>
            <button className="plan-step-reorder-btn" onClick={onMoveDown} disabled={isLast} title="Move down">
              <ChevronDown size={11} />
            </button>
          </span>
        )}
        {isExpandable && (
          <span className="plan-step-expand-icon">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </div>

      {expanded && (
        <div className="plan-step-summary">
          {step.state === "complete" && step.contextSummary ? (
            editingSummary ? (
              <div className="plan-step-summary-editor">
                <textarea
                  className="plan-editor-instruction-input"
                  value={summaryDraft}
                  rows={3}
                  autoFocus
                  onChange={e => setSummaryDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveSummary();
                    if (e.key === "Escape") cancelEditing();
                  }}
                />
                <div className="plan-step-summary-edit-actions">
                  <button className="plan-btn plan-btn--primary plan-btn--sm" onClick={saveSummary}>
                    <Check size={11} /> Save
                  </button>
                  <button className="plan-btn plan-btn--ghost plan-btn--sm" onClick={cancelEditing}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="plan-step-summary-text">
                <span>{step.contextSummary}</span>
                <button className="plan-step-summary-edit-btn" onClick={startEditing} title="Edit context summary">
                  <PencilLine size={11} />
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
              <button className="plan-btn plan-btn--sm" onClick={() => onRetry(planId, step.id)}>
                <RotateCcw size={11} /> Retry
              </button>
              <button className="plan-btn plan-btn--sm plan-btn--ghost" onClick={() => onSkip(planId, step.id)}>
                <SkipForward size={11} /> Skip
              </button>
            </div>
          )}
        </div>
      )}

      {step.state === "awaiting_approval" && planState === "awaiting_step" && (
        <div className="plan-step-approve">
          {editingInstruction ? (
            <>
              <textarea
                className="plan-editor-instruction-input"
                value={instructionDraft}
                rows={3}
                autoFocus
                onChange={e => setInstructionDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    onEditInstruction(planId, step.id, instructionDraft.trim());
                    setEditingInstruction(false);
                  }
                  if (e.key === "Escape") setEditingInstruction(false);
                }}
              />
              <div className="plan-step-summary-edit-actions">
                <button
                  className="plan-btn plan-btn--primary plan-btn--sm"
                  onClick={() => { onEditInstruction(planId, step.id, instructionDraft.trim()); setEditingInstruction(false); }}
                >
                  <Check size={11} /> Save
                </button>
                <button className="plan-btn plan-btn--ghost plan-btn--sm" onClick={() => setEditingInstruction(false)}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="plan-step-summary-text">
              <span className="plan-step-instruction-preview">{step.instruction}</span>
              <button
                className="plan-step-summary-edit-btn"
                onClick={() => { setInstructionDraft(step.instruction); setEditingInstruction(true); }}
                title="Edit instruction"
              >
                <PencilLine size={11} />
              </button>
            </div>
          )}
          <button className="plan-btn plan-btn--primary" onClick={() => onApproveStep(planId, step.id)}>
            <Play size={12} /> Run this step
          </button>
        </div>
      )}
    </div>
  );
}

// ── Step editor (amend steps during awaiting_approval) ───────────────────────

interface StepEditorProps {
  steps: EpistemePlanStep[];
  onSave: (drafts: PlanStepDraft[]) => void;
  onCancel: () => void;
}

function StepEditor({ steps, onSave, onCancel }: StepEditorProps) {
  const [drafts, setDrafts] = useState<PlanStepDraft[]>(
    steps.map(s => ({ type: s.type, title: s.title, instruction: s.instruction })),
  );

  const update = (i: number, field: keyof PlanStepDraft, value: string) => {
    setDrafts(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: value } : d));
  };

  return (
    <div className="plan-editor">
      <div className="plan-editor-steps">
        {drafts.map((d, i) => (
          <div key={i} className="plan-editor-step">
            <div className="plan-editor-step-row">
              <span className="plan-step-num">{i + 1}</span>
              <select
                className="plan-editor-type-select"
                value={d.type}
                onChange={e => update(i, "type", e.target.value)}
              >
                {ALL_STEP_TYPES.map(t => (
                  <option key={t} value={t}>{STEP_TYPE_LABELS[t]}</option>
                ))}
              </select>
              <input
                className="plan-editor-title-input"
                value={d.title}
                placeholder="Step title"
                onChange={e => update(i, "title", e.target.value)}
              />
            </div>
            <textarea
              className="plan-editor-instruction-input"
              value={d.instruction}
              rows={2}
              placeholder="Step instruction"
              onChange={e => update(i, "instruction", e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="plan-editor-actions">
        <button className="plan-btn plan-btn--primary" onClick={() => onSave(drafts)}>
          Save changes
        </button>
        <button className="plan-btn plan-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Add step form ─────────────────────────────────────────────────────────────

interface AddStepFormProps {
  isLoading: boolean;
  existingSteps: EpistemePlanStep[];
  defaultInsertAfterStepId?: string | null;
  onAdd: (description: string, insertAfterStepId?: string | null) => void;
  onCancel: () => void;
}

function AddStepForm({ isLoading, existingSteps, defaultInsertAfterStepId, onAdd, onCancel }: AddStepFormProps) {
  const [description, setDescription] = useState("");
  const fallbackPosition = existingSteps.length > 0 ? existingSteps[existingSteps.length - 1]!.id : null;
  const [insertAfterStepId, setInsertAfterStepId] = useState<string | null>(
    defaultInsertAfterStepId !== undefined ? defaultInsertAfterStepId : fallbackPosition,
  );

  const handleSubmit = () => {
    if (!description.trim() || isLoading) return;
    onAdd(description.trim(), insertAfterStepId);
  };

  const handlePositionChange = (value: string) => {
    setInsertAfterStepId(value === "__start__" ? null : value);
  };

  return (
    <div className="plan-add-step-form">
      {existingSteps.length > 1 && (
        <select
          className="plan-add-step-position"
          value={insertAfterStepId ?? "__start__"}
          onChange={e => handlePositionChange(e.target.value)}
          disabled={isLoading}
        >
          <option value="__start__">At the beginning</option>
          {existingSteps.map((s, i) => (
            <option key={s.id} value={s.id}>
              After step {i + 1}: {s.title.length > 30 ? s.title.slice(0, 30) + "…" : s.title}
            </option>
          ))}
        </select>
      )}
      <textarea
        className="plan-editor-instruction-input"
        placeholder="Describe the step to add…"
        value={description}
        rows={2}
        autoFocus
        onChange={e => setDescription(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="plan-add-step-actions">
        <button
          className="plan-btn plan-btn--primary plan-btn--sm"
          onClick={handleSubmit}
          disabled={!description.trim() || isLoading}
        >
          {isLoading
            ? <><Loader2 size={11} className="plan-step-icon-spin" /> Adding…</>
            : <><Plus size={11} /> Add step</>}
        </button>
        <button className="plan-btn plan-btn--ghost plan-btn--sm" onClick={onCancel} disabled={isLoading}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Plan request form ─────────────────────────────────────────────────────────

interface PlanRequestFormProps {
  activeFile: string | null;
  followingUp?: { id: string; goal: string } | null;
  onClearFollowup?: () => void;
  onRequest: (goal: string, approvalMode: PlanApprovalMode, previousPlanId?: string) => void;
  onRequestFromDocument: (path: string, goal: string, approvalMode: PlanApprovalMode, previousPlanId?: string) => void;
}

function PlanRequestForm({ activeFile, followingUp, onClearFollowup, onRequest, onRequestFromDocument }: PlanRequestFormProps) {
  const [goal, setGoal] = useState("");
  const [approvalMode, setApprovalMode] = useState<PlanApprovalMode>("all");
  const [useDocument, setUseDocument] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) return;
    const prevId = followingUp?.id;
    if (useDocument && activeFile) {
      onRequestFromDocument(activeFile, goal.trim(), approvalMode, prevId);
    } else {
      onRequest(goal.trim(), approvalMode, prevId);
    }
    setGoal("");
  };

  return (
    <form className="plan-request-form" onSubmit={handleSubmit}>
      {followingUp && (
        <div className="plan-followup-badge">
          <span>Following up: <em>{followingUp.goal}</em></span>
          <button type="button" className="plan-followup-clear" onClick={onClearFollowup} title="Start a fresh plan instead">
            <X size={11} />
          </button>
        </div>
      )}
      <textarea
        className="plan-request-textarea"
        placeholder={followingUp ? "What do you want to do next?" : "Describe what you want to accomplish…"}
        value={goal}
        rows={3}
        onChange={e => setGoal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit(e); }}
      />
      <div className="plan-request-options">
        <label className="plan-request-label">
          <input
            type="radio"
            name="approvalMode"
            value="all"
            checked={approvalMode === "all"}
            onChange={() => setApprovalMode("all")}
          />
          <span>Approve all at once</span>
        </label>
        <label className="plan-request-label">
          <input
            type="radio"
            name="approvalMode"
            value="per_step"
            checked={approvalMode === "per_step"}
            onChange={() => setApprovalMode("per_step")}
          />
          <span>Approve step-by-step</span>
        </label>
      </div>
      {activeFile && (
        <label className="plan-request-label">
          <input
            type="checkbox"
            checked={useDocument}
            onChange={e => setUseDocument(e.target.checked)}
          />
          <span>Plan from current document</span>
        </label>
      )}
      <button className="plan-btn plan-btn--primary plan-btn--full" type="submit" disabled={!goal.trim()}>
        <ClipboardList size={14} /> {followingUp ? "Create follow-up plan" : "Create plan"}
      </button>
    </form>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export interface PlanPanelProps {
  plan: EpistemePlan | null;
  activeFile: string | null;
  agentState: string;
  onClose: () => void;
  onRequestPlan: (goal: string, approvalMode: PlanApprovalMode) => void;
  onRequestPlanFromDocument: (path: string, goal: string, approvalMode: PlanApprovalMode) => void;
  onApprovePlan: (planId: string) => void;
  onApproveStep: (planId: string, stepId: string) => void;
  onRetryStep: (planId: string, stepId: string) => void;
  onSkipStep: (planId: string, stepId: string) => void;
  onAmendSteps: (planId: string, steps: PlanStepDraft[]) => void;
  onEditStepSummary: (planId: string, stepId: string, summary: string) => void;
  onEditStepInstruction: (planId: string, stepId: string, instruction: string) => void;
  onAddStep: (planId: string, description: string, insertAfterStepId?: string | null) => void;
  onReorderStep: (planId: string, stepId: string, direction: "up" | "down") => void;
  onPause: () => void;
  onResume: () => void;
  onResumeAuto: () => void;
  onCancel: () => void;
  onNewPlan: () => void;
}

const PLAN_STATE_LABELS: Record<string, string> = {
  structuring:       "Structuring…",
  awaiting_approval: "Review plan",
  awaiting_step:     "Step-by-step",
  executing:         "Executing",
  step_failed:       "Step failed",
  paused:            "Paused",
  complete:          "Complete",
  cancelled:         "Cancelled",
};

export function PlanPanel({
  plan, activeFile, agentState,
  onClose, onRequestPlan, onRequestPlanFromDocument,
  onApprovePlan, onApproveStep, onRetryStep, onSkipStep,
  onAmendSteps, onEditStepSummary, onEditStepInstruction, onAddStep, onReorderStep,
  onPause, onResume, onResumeAuto, onCancel, onNewPlan,
}: PlanPanelProps) {
  const [editing, setEditing] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [followingUp, setFollowingUp] = useState<{ id: string; goal: string } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingStep, setAddingStep] = useState(false);
  const prevStepsLenRef = useRef(plan?.steps.length ?? 0);

  // Reset transitional states when the server confirms the transition
  useEffect(() => {
    if (plan?.state === "paused" || plan?.state === "executing") setPausing(false);
  }, [plan?.state]);

  useEffect(() => {
    if (plan?.state === "cancelled") setCancelling(false);
  }, [plan?.state]);

  // Auto-close add-step form when server confirms the new step arrived
  useEffect(() => {
    const len = plan?.steps.length ?? 0;
    if (addingStep && len > prevStepsLenRef.current) {
      setShowAddForm(false);
      setAddingStep(false);
    }
    prevStepsLenRef.current = len;
  }, [plan?.steps.length, addingStep]);

  const currentStepId = plan?.steps.find(
    s => s.state === "running" || s.state === "awaiting_approval",
  )?.id;

  const doneCount = plan ? plan.steps.filter(s => s.state === "complete" || s.state === "skipped").length : 0;
  const total = plan?.steps.length ?? 0;
  const progress = total > 0 ? (doneCount / total) * 100 : 0;

  const isStructuring = agentState === "structuring";

  // Compute action bar content — returns null when the bar should be hidden entirely
  const actionBarContent = (() => {
    if (!plan) return null;

    if (cancelling) {
      return (
        <span className="plan-cancelling-message">
          <Loader2 size={14} className="plan-step-icon-spin" /> Cancelling…
        </span>
      );
    }

    switch (plan.state) {
      case "awaiting_approval":
        return (
          <>
            <button className="plan-btn plan-btn--primary" onClick={() => onApprovePlan(plan.id)}>
              <Play size={13} /> Start plan
            </button>
            {!editing && (
              <button className="plan-btn plan-btn--ghost" onClick={() => setEditing(true)}>
                Edit steps
              </button>
            )}
            <button className="plan-btn plan-btn--ghost" onClick={() => { setCancelling(true); onCancel(); }}>
              <Ban size={13} /> Cancel
            </button>
          </>
        );

      case "executing":
        return (
          <button
            className="plan-btn plan-btn--ghost"
            onClick={() => { setPausing(true); onPause(); }}
            disabled={pausing}
          >
            {pausing
              ? <><Loader2 size={13} className="plan-step-icon-spin" /> Pausing…</>
              : <><Pause size={13} /> Pause after step</>}
          </button>
        );

      case "awaiting_step":
        return (
          <button className="plan-btn plan-btn--ghost plan-btn--sm" onClick={onResumeAuto}>
            Run all remaining
          </button>
        );

      case "paused":
        return (
          <>
            <button className="plan-btn plan-btn--primary" onClick={onResume}>
              <Play size={13} /> Resume
            </button>
            {plan.approvalMode === "per_step" && (
              <button className="plan-btn plan-btn--ghost" onClick={onResumeAuto}>
                Run all remaining
              </button>
            )}
            <button className="plan-btn plan-btn--ghost" onClick={() => { setCancelling(true); onCancel(); }}>
              <Ban size={13} /> Cancel
            </button>
          </>
        );

      case "step_failed":
        return (
          <button className="plan-btn plan-btn--ghost" onClick={() => { setCancelling(true); onCancel(); }}>
            <Ban size={13} /> Cancel plan
          </button>
        );

      case "complete":
        return (
          <>
            <span className="plan-complete-message">
              <CheckCircle2 size={14} /> Complete ({doneCount}/{total} steps)
            </span>
            <button
              className="plan-btn plan-btn--primary plan-btn--sm"
              onClick={() => { setFollowingUp({ id: plan.id, goal: plan.goal }); onNewPlan(); }}
            >
              Follow-up plan
            </button>
            <button className="plan-btn plan-btn--ghost plan-btn--sm" onClick={onNewPlan}>
              New plan
            </button>
          </>
        );

      case "cancelled":
        return (
          <button className="plan-btn plan-btn--ghost" onClick={onNewPlan}>
            <ClipboardList size={13} /> New plan
          </button>
        );

      default:
        return null;
    }
  })();

  return (
    <div className="plan-panel">
      <div className="plan-panel-header">
        <span className="plan-panel-title">
          <ClipboardList size={15} />
          Plan
        </span>
        <button className="plan-panel-close" onClick={onClose} aria-label="Close plan panel">
          <X size={15} />
        </button>
      </div>

      {isStructuring && (
        <div className="plan-structuring">
          <Loader2 size={16} className="plan-step-icon-spin" />
          <span>Structuring plan…</span>
        </div>
      )}

      {!plan && !isStructuring && (
        <PlanRequestForm
          activeFile={activeFile}
          followingUp={followingUp}
          onClearFollowup={() => setFollowingUp(null)}
          onRequest={onRequestPlan}
          onRequestFromDocument={onRequestPlanFromDocument}
        />
      )}

      {plan && (
        <>
          <div className="plan-goal">
            <span className="plan-goal-text">{plan.goal}</span>
            <span className={`plan-state-badge plan-state-badge--${plan.state}`}>
              {PLAN_STATE_LABELS[plan.state] ?? plan.state}
            </span>
          </div>

          {total > 0 && (
            <div className="plan-progress-bar">
              <div className="plan-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}

          {editing ? (
            <StepEditor
              steps={plan.steps}
              onSave={(drafts) => { onAmendSteps(plan.id, drafts); setEditing(false); }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="plan-steps">
              {plan.steps.map((step, i) => (
                <StepRow
                  key={step.id}
                  step={step}
                  index={i}
                  isCurrent={step.id === currentStepId}
                  isFirst={i === 0}
                  isLast={i === plan.steps.length - 1}
                  planState={plan.state}
                  planId={plan.id}
                  onApproveStep={onApproveStep}
                  onRetry={onRetryStep}
                  onSkip={onSkipStep}
                  onEditSummary={onEditStepSummary}
                  onEditInstruction={onEditStepInstruction}
                  onMoveUp={() => onReorderStep(plan.id, step.id, "up")}
                  onMoveDown={() => onReorderStep(plan.id, step.id, "down")}
                />
              ))}
              {(plan.state === "awaiting_approval" || plan.state === "awaiting_step") && (
                showAddForm ? (
                  <AddStepForm
                    isLoading={addingStep}
                    existingSteps={plan.steps}
                    defaultInsertAfterStepId={plan.state === "awaiting_step" ? currentStepId : undefined}
                    onAdd={(desc, insertAfterStepId) => { setAddingStep(true); onAddStep(plan.id, desc, insertAfterStepId); }}
                    onCancel={() => { setShowAddForm(false); setAddingStep(false); }}
                  />
                ) : (
                  <button className="plan-add-step-btn" onClick={() => setShowAddForm(true)}>
                    <Plus size={12} /> Add step
                  </button>
                )
              )}
            </div>
          )}

          {actionBarContent && (
            <div className="plan-actions">
              {actionBarContent}
            </div>
          )}
        </>
      )}
    </div>
  );
}
