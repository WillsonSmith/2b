import { Button } from "../../../primitives/Button.tsx";
import type { SidecarMessage } from "../types.ts";

interface NotificationRowProps {
  message: Extract<SidecarMessage, { role: "notification" }>;
}

export function NotificationRow({ message }: NotificationRowProps) {
  return (
    <div className="ep-sidecar__msg ep-sidecar__msg--notification">
      <span className="ep-sidecar__notification-text">{message.text}</span>
      <Button size="sm" variant="ghost" onClick={message.onAction}>
        {message.actionLabel}
      </Button>
    </div>
  );
}
