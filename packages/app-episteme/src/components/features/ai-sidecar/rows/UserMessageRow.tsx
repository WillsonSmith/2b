import { Trash2 } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import { IconButton } from "../../../primitives/IconButton.tsx";
import { useAI } from "../../../../state/AIContext.tsx";
import { extractMentions } from "../mentions.ts";
import { FileMentionChip } from "../FileMentionChip.tsx";
import type { SidecarMessage } from "../types.ts";

interface UserMessageRowProps {
  message: Extract<SidecarMessage, { role: "user" }>;
  index: number;
}

export function UserMessageRow({ message, index }: UserMessageRowProps) {
  const ai = useAI();
  const mentions = extractMentions(message.text);

  return (
    <div className="ep-sidecar__msg ep-sidecar__msg--user">
      <div className="ep-sidecar__msg-header">
        <span className="ep-sidecar__msg-role">You</span>
        <IconButton
          icon={<Icon icon={Trash2} size="xs" />}
          aria-label="Delete message"
          size="sm"
          onClick={() => ai.deleteMessage(index)}
          className="ep-sidecar__msg-action"
        />
      </div>
      <div className="ep-sidecar__msg-user-text">{message.text}</div>
      {mentions.length > 0 && (
        <div className="ep-sidecar__mention-footer">
          {mentions.map((p) => (
            <FileMentionChip key={p} path={p} onRemove={() => ai.removeMention(index, p)} />
          ))}
        </div>
      )}
    </div>
  );
}
