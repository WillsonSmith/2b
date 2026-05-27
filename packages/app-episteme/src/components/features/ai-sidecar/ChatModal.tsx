import { useEffect, useRef } from "react";
import { ModalShell } from "../../composites/ModalShell.tsx";
import { useAI } from "../../../state/AIContext.tsx";
import { useSignalValue } from "../../../state/signals.ts";
import { MessageList } from "./MessageList.tsx";
import { ChatComposer } from "./ChatComposer.tsx";

interface ChatModalProps {
  open: boolean;
  workspaceFiles: ReadonlyArray<string>;
  activeFile?: string | null;
  onNavigate?: (path: string) => void;
  onClose: () => void;
}

export function ChatModal({ open, workspaceFiles, activeFile, onNavigate, onClose }: ChatModalProps) {
  const ai = useAI();
  const messages = useSignalValue(ai.messages);
  const isThinking = useSignalValue(ai.agentState) === "thinking";
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [open, messages, isThinking]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Episteme AI"
      width="min(800px, 92vw)"
      className="ep-sidecar__chat-modal"
    >
      <div className="ep-sidecar__chat-modal-body">
        <MessageList endRef={endRef} onNavigate={onNavigate} />
        <ChatComposer workspaceFiles={workspaceFiles} activeFile={activeFile} />
      </div>
    </ModalShell>
  );
}
