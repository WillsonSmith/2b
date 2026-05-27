import { useEffect, useRef } from "react";
import { Maximize2 } from "lucide-react";
import { Icon } from "../../primitives/Icon.tsx";
import { IconButton } from "../../primitives/IconButton.tsx";
import { ResizeHandle } from "../../composites/ResizeHandle.tsx";
import { usePanelResize } from "../../../hooks/usePanelResize.ts";
import { useAI } from "../../../state/AIContext.tsx";
import { useSignalValue } from "../../../state/signals.ts";
import { MessageList } from "./MessageList.tsx";
import { ChatComposer } from "./ChatComposer.tsx";

interface SidecarPanelProps {
  workspaceFiles: ReadonlyArray<string>;
  activeFile?: string | null;
  onNavigate?: (path: string) => void;
  onExpand: () => void;
}

export function SidecarPanel({ workspaceFiles, activeFile, onNavigate, onExpand }: SidecarPanelProps) {
  const ai = useAI();
  const collapsed = useSignalValue(ai.sidecarCollapsed);
  const messages = useSignalValue(ai.messages);
  const isThinking = useSignalValue(ai.agentState) === "thinking";
  const endRef = useRef<HTMLDivElement | null>(null);
  const { width, handleMouseDown, isDragging } = usePanelResize(300, "ai-sidecar");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  const trackStyle = collapsed ? undefined : { width, transition: isDragging ? "none" : undefined };

  return (
    <div
      className={`ep-sidecar__track${collapsed ? " ep-sidecar__track--collapsed" : ""}`}
      style={trackStyle}
    >
      <div className="ep-sidecar" style={{ width, minWidth: width }}>
        {!collapsed && <ResizeHandle edge="left" onMouseDown={handleMouseDown} />}
        <div className="ep-sidecar__header">
          <span className="ep-sidecar__title">Episteme AI</span>
          <IconButton
            icon={<Icon icon={Maximize2} size="sm" />}
            aria-label="Open full-screen chat"
            size="sm"
            onClick={onExpand}
          />
        </div>
        <MessageList endRef={endRef} onNavigate={onNavigate} />
        <ChatComposer workspaceFiles={workspaceFiles} activeFile={activeFile} />
      </div>
    </div>
  );
}
