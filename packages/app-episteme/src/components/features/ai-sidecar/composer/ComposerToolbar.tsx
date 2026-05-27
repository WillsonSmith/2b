import { Zap, ClipboardList, GitBranch, ArrowUp, Square } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import { IconButton } from "../../../primitives/IconButton.tsx";
import { StatusPill } from "../../../composites/StatusPill.tsx";
import type { DotTone } from "../../../primitives/Dot.tsx";

export type AgentDisplayState = "ready" | "thinking" | "disconnected" | "provider-down";

interface ComposerToolbarProps {
  agentState: AgentDisplayState;
  showQuickActions: boolean;
  onToggleQuickActions: () => void;
  planMode: boolean;
  onTogglePlanMode: () => void;
  followUpMode: boolean;
  onToggleFollowUpMode: () => void;
  activePlanGoal?: string;
  isThinking: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  onInterrupt: () => void;
}

function statusFor(state: AgentDisplayState): { tone: DotTone; label: string; pulse: boolean } {
  switch (state) {
    case "thinking":
      return { tone: "info", label: "thinking", pulse: true };
    case "disconnected":
      return { tone: "danger", label: "offline", pulse: false };
    case "provider-down":
      return { tone: "danger", label: "Ollama offline", pulse: false };
    case "ready":
      return { tone: "success", label: "ready", pulse: false };
  }
}

export function ComposerToolbar({
  agentState,
  showQuickActions,
  onToggleQuickActions,
  planMode,
  onTogglePlanMode,
  followUpMode,
  onToggleFollowUpMode,
  activePlanGoal,
  isThinking,
  canSubmit,
  onSubmit,
  onInterrupt,
}: ComposerToolbarProps) {
  const status = statusFor(agentState);

  return (
    <div className="ep-sidecar__composer-toolbar">
      <IconButton
        icon={<Icon icon={Zap} size="sm" />}
        aria-label={showQuickActions ? "Hide quick actions" : "Show quick actions"}
        size="sm"
        variant="ghost"
        onClick={onToggleQuickActions}
        className={showQuickActions ? "ep-sidecar__toolbar-toggle--active" : undefined}
      />
      <IconButton
        icon={<Icon icon={ClipboardList} size="sm" />}
        aria-label={planMode ? "Exit planning mode" : "Create a plan"}
        size="sm"
        variant="ghost"
        onClick={onTogglePlanMode}
        disabled={isThinking}
        className={planMode ? "ep-sidecar__toolbar-toggle--active" : undefined}
      />
      <IconButton
        icon={<Icon icon={GitBranch} size="sm" />}
        aria-label={
          !activePlanGoal
            ? "Follow up plan — disabled (no active plan)"
            : followUpMode
              ? "Exit follow-up mode"
              : `Follow up active plan: ${activePlanGoal}`
        }
        size="sm"
        variant="ghost"
        onClick={onToggleFollowUpMode}
        disabled={isThinking || !activePlanGoal}
        className={followUpMode ? "ep-sidecar__toolbar-toggle--active" : undefined}
      />

      <StatusPill tone={status.tone} pulse={status.pulse} className="ep-sidecar__status">
        {status.label}
      </StatusPill>

      {isThinking ? (
        <IconButton
          icon={<Square size={12} fill="currentColor" />}
          aria-label="Stop"
          size="sm"
          variant="ghost"
          onClick={onInterrupt}
        />
      ) : (
        <IconButton
          icon={<Icon icon={ArrowUp} size="sm" />}
          aria-label="Send"
          size="sm"
          variant="solid"
          shape="circle"
          onClick={onSubmit}
          disabled={!canSubmit}
        />
      )}
    </div>
  );
}
