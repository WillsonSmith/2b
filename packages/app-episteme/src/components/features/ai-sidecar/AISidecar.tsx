import { useState } from "react";
import { SidecarPanel } from "./SidecarPanel.tsx";
import { ChatModal } from "./ChatModal.tsx";

export type { SidecarMessage } from "./types.ts";

interface AISidecarProps {
  workspaceFiles?: ReadonlyArray<string>;
  activeFile?: string | null;
  onNavigate?: (path: string) => void;
}

export function AISidecar({ workspaceFiles = [], activeFile, onNavigate }: AISidecarProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <SidecarPanel
        workspaceFiles={workspaceFiles}
        activeFile={activeFile}
        onNavigate={onNavigate}
        onExpand={() => setExpanded(true)}
      />
      <ChatModal
        open={expanded}
        workspaceFiles={workspaceFiles}
        activeFile={activeFile}
        onNavigate={onNavigate}
        onClose={() => setExpanded(false)}
      />
    </>
  );
}
