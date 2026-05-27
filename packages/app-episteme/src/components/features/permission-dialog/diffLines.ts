import type { DiffRow } from "../../composites/DiffView.tsx";

/**
 * Minimal LCS-based line diff. Good enough for previewing a small edit —
 * we're not trying to compete with `diff` package quality, just give the
 * user enough signal to decide whether to approve.
 *
 * Caps the diff at 1000 lines per side so a huge write_file doesn't lock
 * the UI thread. When capped we degrade to a "current ⇒ proposed" stacked
 * view (everything in `current` shown as removed, everything in `proposed`
 * shown as added) which is still useful for an approve/deny call.
 */
export function diffLines(a: string, b: string): DiffRow[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const CAP = 1000;
  if (aLines.length > CAP || bLines.length > CAP) {
    return [
      ...aLines.slice(0, CAP).map((text): DiffRow => ({ kind: "remove", text })),
      ...bLines.slice(0, CAP).map((text): DiffRow => ({ kind: "add", text })),
    ];
  }
  const n = aLines.length;
  const m = bLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      rows.push({ kind: "context", text: aLines[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ kind: "remove", text: aLines[i]! });
      i++;
    } else {
      rows.push({ kind: "add", text: bLines[j]! });
      j++;
    }
  }
  while (i < n) rows.push({ kind: "remove", text: aLines[i++]! });
  while (j < m) rows.push({ kind: "add", text: bLines[j++]! });
  return rows;
}
