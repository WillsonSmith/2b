import { Check, CornerDownRight, AlertCircle } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import { Spinner } from "../../../primitives/Spinner.tsx";
import { Disclosure } from "../../../composites/Disclosure.tsx";
import { toolDisplayName } from "../quickActions.ts";
import type { SidecarMessage } from "../types.ts";

interface ToolRowProps {
  message: Extract<SidecarMessage, { role: "tool" }>;
}

export function ToolRow({ message }: ToolRowProps) {
  const label = toolDisplayName(message.name);

  if (message.status === "calling") {
    return (
      <div className="ep-sidecar__tool-row ep-sidecar__tool-row--calling">
        <Icon icon={CornerDownRight} size="xs" className="ep-sidecar__tool-arrow" />
        <span className="ep-sidecar__tool-name">{label}</span>
        <Spinner size="xs" />
      </div>
    );
  }

  const statusIcon =
    message.status === "error" ? (
      <Icon icon={AlertCircle} size="xs" className="ep-sidecar__tool-icon ep-sidecar__tool-icon--error" />
    ) : (
      <Icon icon={Check} size="xs" />
    );

  return (
    <Disclosure
      className={`ep-sidecar__tool-row ep-sidecar__tool-row--${message.status}`}
      icon={<Icon icon={CornerDownRight} size="xs" className="ep-sidecar__tool-arrow" />}
      summary={<span className="ep-sidecar__tool-name">{label}</span>}
      meta={statusIcon}
    >
      {message.error ? (
        <span className="ep-sidecar__tool-error">{message.error}</span>
      ) : (
        <span className="ep-sidecar__tool-ok">Completed successfully</span>
      )}
    </Disclosure>
  );
}
