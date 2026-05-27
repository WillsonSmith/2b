import { Button } from "../../../primitives/Button.tsx";
import { Text } from "../../../primitives/Text.tsx";
import { QUICK_ACTIONS } from "../quickActions.ts";

interface QuickActionsPanelProps {
  onPick: (prompt: string) => void;
}

export function QuickActionsPanel({ onPick }: QuickActionsPanelProps) {
  return (
    <div className="ep-sidecar__quick-actions">
      <Text variant="caption" tone="muted">Quick Actions</Text>
      <div className="ep-sidecar__quick-grid">
        {QUICK_ACTIONS.map((a) => (
          <Button
            key={a.label}
            size="sm"
            variant="ghost"
            onClick={() => onPick(a.prompt)}
            title={a.prompt}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
