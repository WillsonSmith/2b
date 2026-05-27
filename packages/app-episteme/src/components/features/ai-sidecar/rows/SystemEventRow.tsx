import { Layers } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import type { SidecarMessage } from "../types.ts";

interface SystemEventRowProps {
  message: Extract<SidecarMessage, { role: "system_event" }>;
}

export function SystemEventRow({ message }: SystemEventRowProps) {
  return (
    <div className="ep-sidecar__system-event">
      <Icon icon={Layers} size="xs" />
      <span className="ep-sidecar__system-event-text">{message.text}</span>
    </div>
  );
}
