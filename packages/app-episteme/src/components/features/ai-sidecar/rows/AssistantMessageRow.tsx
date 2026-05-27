import { useRef, useState } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import { IconButton } from "../../../primitives/IconButton.tsx";
import { Menu } from "../../../composites/Menu.tsx";
import type { MenuEntry } from "../../../composites/Menu.tsx";
import { MarkdownView } from "../../../MarkdownView.tsx";
import { useAI } from "../../../../state/AIContext.tsx";
import { FollowUpComposer } from "../FollowUpComposer.tsx";
import type { SidecarMessage } from "../types.ts";

interface AssistantMessageRowProps {
  message: Extract<SidecarMessage, { role: "assistant" }>;
  index: number;
  onNavigate?: (path: string) => void;
}

export function AssistantMessageRow({ message, index, onNavigate }: AssistantMessageRowProps) {
  const ai = useAI();
  const [menuOpen, setMenuOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const menuItems: MenuEntry[] = [
    { id: "regen", label: "Regenerate", onSelect: () => ai.regenerate(index) },
    {
      id: "copy",
      label: "Copy",
      onSelect: () => {
        navigator.clipboard.writeText(message.text).catch(() => {});
      },
    },
    { id: "send-plan", label: "Send to Plan", onSelect: () => ai.sendToPlan(message.text) },
    { id: "follow-up", label: "Follow up plan…", onSelect: () => setFollowUpOpen(true) },
  ];

  return (
    <div className="ep-sidecar__msg ep-sidecar__msg--assistant">
      <div className="ep-sidecar__msg-header">
        <span className="ep-sidecar__msg-role">Episteme</span>
        <div className="ep-sidecar__msg-header-actions">
          <IconButton
            ref={menuTriggerRef}
            icon={<Icon icon={MoreHorizontal} size="xs" />}
            aria-label="Message actions"
            size="sm"
            onClick={() => setMenuOpen((v) => !v)}
          />
          <Menu
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            anchorRef={menuTriggerRef}
            items={menuItems}
            placement="bottom-end"
          />
          <IconButton
            icon={<Icon icon={Trash2} size="xs" />}
            aria-label="Delete message"
            size="sm"
            onClick={() => ai.deleteMessage(index)}
            className="ep-sidecar__msg-action"
          />
        </div>
      </div>
      <MarkdownView content={message.text} className="ep-sidecar__msg-markdown" onNavigate={onNavigate} />
      {followUpOpen && <FollowUpComposer onClose={() => setFollowUpOpen(false)} />}
    </div>
  );
}
