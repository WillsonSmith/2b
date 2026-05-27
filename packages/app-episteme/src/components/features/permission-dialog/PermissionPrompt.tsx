import { Button } from "../../primitives/Button.tsx";
import { ModalShell } from "../../composites/ModalShell.tsx";
import { FileDiffView } from "./FileDiffView.tsx";
import { ToolArgsView } from "./ToolArgsView.tsx";
import type { Decision, PendingPrompt } from "./types.ts";

interface PermissionPromptProps {
  prompt: PendingPrompt;
  onDecide: (decision: Decision) => void;
}

export function PermissionPrompt({ prompt, onDecide }: PermissionPromptProps) {
  return (
    <ModalShell
      open
      title={
        <>
          <span className="permission-dialog-agent">{prompt.agentName}</span> wants to use{" "}
          <code>{prompt.toolName}</code>
        </>
      }
      width="min(720px, 92vw)"
      className="permission-dialog"
      closeOnBackdrop={false}
      closeOnEsc={false}
      footer={
        <>
          <Button variant="ghost" onClick={() => onDecide("deny")} autoFocus>
            Deny
          </Button>
          <div style={{ flex: 1 }} />
          <Button variant="ghost" onClick={() => onDecide("allow_session")}>
            Allow this session
          </Button>
          <Button variant="solid" onClick={() => onDecide("allow_once")}>
            Allow once
          </Button>
        </>
      }
    >
      {prompt.fileDiff ? (
        <FileDiffView
          path={prompt.fileDiff.path}
          currentContent={prompt.fileDiff.currentContent}
          proposedContent={prompt.fileDiff.proposedContent}
        />
      ) : (
        <ToolArgsView args={prompt.args} />
      )}
    </ModalShell>
  );
}
