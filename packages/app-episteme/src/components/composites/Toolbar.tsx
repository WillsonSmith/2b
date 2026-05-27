import type { ReactNode } from "react";

export type ToolbarOrientation = "horizontal" | "vertical";

interface ToolbarProps {
  children: ReactNode;
  orientation?: ToolbarOrientation;
  ariaLabel?: string;
  className?: string;
}

export function Toolbar({ children, orientation = "horizontal", ariaLabel, className }: ToolbarProps) {
  const classes = ["ep-toolbar", `ep-toolbar--${orientation}`, className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="toolbar" aria-label={ariaLabel} aria-orientation={orientation}>
      {children}
    </div>
  );
}
