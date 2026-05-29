import type { StyleBudget, StyleSection } from "./types.ts";

export const BUDGET_CAP = 4000;

/**
 * Mirror of the server's budget logic (StyleGuidePlugin.assemble) so the meter
 * updates live as the user types, without a round-trip. Enabled sections fill
 * greedily in order; sections that would push the cumulative body length over
 * the cap are dropped (highest `order` first). `used` is the total of all
 * enabled bodies, so the meter can show an over-budget state.
 */
export function computeBudget(sections: StyleSection[]): StyleBudget {
  const enabled = sections
    .filter((s) => s.enabled)
    .slice()
    .sort((a, b) => a.order - b.order);
  let running = 0;
  let used = 0;
  let overflowing = false;
  const droppedSectionIds: string[] = [];
  for (const section of enabled) {
    const len = section.body.trim().length;
    used += len;
    if (!overflowing && running + len <= BUDGET_CAP) {
      running += len;
    } else {
      overflowing = true;
      droppedSectionIds.push(section.id);
    }
  }
  return { used, cap: BUDGET_CAP, droppedSectionIds };
}
