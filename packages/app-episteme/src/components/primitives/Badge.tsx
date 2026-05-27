import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "warn" | "danger" | "success";

interface BadgeProps {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ tone = "neutral", children, className, title }: BadgeProps) {
  const classes = ["ep-badge", `ep-badge--${tone}`, className].filter(Boolean).join(" ");
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
