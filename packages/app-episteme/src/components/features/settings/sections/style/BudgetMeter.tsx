import { Text } from "../../../../primitives/Text.tsx";
import type { StyleBudget } from "./types.ts";

interface BudgetMeterProps {
  budget: StyleBudget;
}

export function BudgetMeter({ budget }: BudgetMeterProps) {
  const { used, cap, droppedSectionIds } = budget;
  const pct = Math.min(100, Math.round((used / cap) * 100));
  const over = used > cap;
  const tone = over ? "danger" : used > cap * 0.85 ? "warning" : "muted";

  return (
    <div className="ep-style-section__meter">
      <div className="ep-style-section__meter-track">
        <div
          className={`ep-style-section__meter-fill${over ? " ep-style-section__meter-fill--over" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <Text variant="caption" tone={tone}>
        {used.toLocaleString()} / {cap.toLocaleString()} chars
        {droppedSectionIds.length > 0 &&
          ` · ${droppedSectionIds.length} section${droppedSectionIds.length === 1 ? "" : "s"} dropped`}
      </Text>
    </div>
  );
}
