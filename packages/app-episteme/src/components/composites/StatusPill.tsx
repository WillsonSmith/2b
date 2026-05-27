import type { ReactNode } from "react";
import { Dot } from "../primitives/Dot.tsx";
import type { DotTone } from "../primitives/Dot.tsx";

interface StatusPillProps {
  tone?: DotTone;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}

export function StatusPill({ tone = "neutral", pulse = false, children, className }: StatusPillProps) {
  const classes = ["ep-status-pill", className].filter(Boolean).join(" ");
  return (
    <span className={classes}>
      <Dot tone={tone} pulse={pulse} />
      <span className="ep-status-pill__label">{children}</span>
    </span>
  );
}
