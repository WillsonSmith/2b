import { GitBranch } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import { Chip } from "../../../primitives/Chip.tsx";

interface FollowUpBadgeProps {
  planGoal: string;
  onClear: () => void;
}

export function FollowUpBadge({ planGoal, onClear }: FollowUpBadgeProps) {
  return (
    <div className="ep-sidecar__followup-badge">
      <Chip
        tone="info"
        iconLeft={<Icon icon={GitBranch} size="xs" />}
        onRemove={onClear}
      >
        Following up: <em>{planGoal}</em>
      </Chip>
    </div>
  );
}
