import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { PlanModeOptions } from "../../PlanModeOptions.tsx";
import { useAI } from "../../../state/AIContext.tsx";
import { useSignalValue } from "../../../state/signals.ts";
import { getMentionQuery, insertMention } from "./mentions.ts";
import { QuickActionsPanel } from "./composer/QuickActionsPanel.tsx";
import { MentionDropdown } from "./composer/MentionDropdown.tsx";
import { FollowUpBadge } from "./composer/FollowUpBadge.tsx";
import { ComposerTextarea } from "./composer/ComposerTextarea.tsx";
import { ComposerToolbar } from "./composer/ComposerToolbar.tsx";
import type { AgentDisplayState } from "./composer/ComposerToolbar.tsx";

interface ChatComposerProps {
  workspaceFiles: ReadonlyArray<string>;
  activeFile?: string | null;
}

function deriveDisplayState(
  agentState: string,
  providerReachable: boolean | null,
): AgentDisplayState {
  if (agentState === "disconnected") return "disconnected";
  if (providerReachable === false) return "provider-down";
  if (agentState === "thinking") return "thinking";
  return "ready";
}

export function ChatComposer({ workspaceFiles, activeFile }: ChatComposerProps) {
  const ai = useAI();
  const agentState = useSignalValue(ai.agentState);
  const providerStatus = useSignalValue(ai.providerStatus);
  const providerReachable = providerStatus?.reachable ?? null;
  const pendingInput = useSignalValue(ai.sidecarPendingInput);
  const activePlan = useSignalValue(ai.activePlan);
  const isThinking = agentState === "thinking";
  const displayState = deriveDisplayState(agentState, providerReachable);

  const [input, setInput] = useState("");
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [planMode, setPlanMode] = useState(false);
  const [followUpMode, setFollowUpMode] = useState(false);
  const [approvalMode, setApprovalMode] = useState<"all" | "per_step">("per_step");
  const [useDocument, setUseDocument] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!activePlan && followUpMode) setFollowUpMode(false);
  }, [activePlan, followUpMode]);

  useEffect(() => {
    if (pendingInput) {
      setInput(pendingInput + " ");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [pendingInput]);

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return workspaceFiles.filter((f) => f.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, workspaceFiles]);

  const closeMention = useCallback(() => {
    setMentionQuery(null);
    setMentionIndex(0);
  }, []);

  const selectMention = useCallback(
    (filename: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const { text, newCursor } = insertMention(input, ta.selectionStart, filename);
      setInput(text);
      closeMention();
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(newCursor, newCursor);
      });
    },
    [input, closeMention],
  );

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    const cursor = e.target.selectionStart ?? val.length;
    setMentionQuery(getMentionQuery(val, cursor));
    setMentionIndex(0);
  };

  const submit = () => {
    const text = input.trim();
    if (!text || isThinking) return;

    if (followUpMode && activePlan) {
      ai.planFollowUp(text, activePlan.id, approvalMode);
      setInput("");
      setFollowUpMode(false);
      ai.sidecarPendingInput.value = "";
      closeMention();
      return;
    }

    if (planMode) {
      if (useDocument && activeFile) ai.planRequestFromDocument(activeFile, text, approvalMode);
      else ai.planRequest(text, approvalMode);
      setInput("");
      setPlanMode(false);
      setUseDocument(false);
      ai.sidecarPendingInput.value = "";
      closeMention();
      return;
    }

    ai.sendToAgent(text);
    setInput("");
    ai.sidecarPendingInput.value = "";
    closeMention();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionMatches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const chosen = mentionMatches[mentionIndex];
        if (chosen) selectMention(chosen);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeMention();
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const placeholder = followUpMode
    ? "What do you want to do next? (@ to reference files)"
    : planMode
      ? "Describe what you want to accomplish… (@ to reference files)"
      : "Ask or give a task… (@ to reference a file)";

  return (
    <div className="ep-sidecar__composer">
      {showQuickActions && (
        <QuickActionsPanel
          onPick={(prompt) => {
            setInput(prompt);
            setShowQuickActions(false);
          }}
        />
      )}

      <MentionDropdown
        matches={mentionMatches}
        activeIndex={mentionIndex}
        onHover={setMentionIndex}
        onPick={selectMention}
      />

      {followUpMode && activePlan && (
        <FollowUpBadge planGoal={activePlan.goal} onClear={() => setFollowUpMode(false)} />
      )}

      {(planMode || followUpMode) && (
        <PlanModeOptions
          approvalMode={approvalMode}
          onApprovalModeChange={setApprovalMode}
          useDocument={useDocument}
          onUseDocumentChange={setUseDocument}
          activeFile={activeFile}
          radioGroupName="sidecar-approval"
          wrapperClassName="ep-sidecar__plan-mode-options"
          labelClassName="ep-sidecar__plan-mode-label"
          withSpans={false}
        />
      )}

      <div className="ep-sidecar__composer-box">
        <ComposerTextarea
          textareaRef={textareaRef}
          value={input}
          placeholder={placeholder}
          disabled={isThinking}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(closeMention, 150)}
        />
        <ComposerToolbar
          agentState={displayState}
          showQuickActions={showQuickActions}
          onToggleQuickActions={() => setShowQuickActions((v) => !v)}
          planMode={planMode}
          onTogglePlanMode={() => {
            setPlanMode((v) => !v);
            if (followUpMode) setFollowUpMode(false);
          }}
          followUpMode={followUpMode}
          onToggleFollowUpMode={() => {
            setFollowUpMode((v) => !v);
            if (planMode) setPlanMode(false);
          }}
          activePlanGoal={activePlan?.goal}
          isThinking={isThinking}
          canSubmit={!!input.trim()}
          onSubmit={submit}
          onInterrupt={() => ai.interrupt()}
        />
      </div>
    </div>
  );
}
