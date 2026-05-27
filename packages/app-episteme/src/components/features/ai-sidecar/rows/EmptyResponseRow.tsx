import { AlertCircle } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import { Button } from "../../../primitives/Button.tsx";
import { useAI } from "../../../../state/AIContext.tsx";
import type { SidecarMessage } from "../types.ts";

interface EmptyResponseRowProps {
  message: Extract<SidecarMessage, { role: "empty_response" }>;
  index: number;
}

export function EmptyResponseRow({ message, index }: EmptyResponseRowProps) {
  const ai = useAI();
  return (
    <div className="ep-sidecar__msg ep-sidecar__msg--empty-response">
      <Icon icon={AlertCircle} size="sm" />
      <span className="ep-sidecar__empty-response-text">
        The model returned an empty response{message.hadThinking ? " after reasoning" : ""}. Try again?
      </span>
      <Button size="sm" variant="ghost" onClick={() => ai.regenerate(index)}>
        Retry
      </Button>
    </div>
  );
}
