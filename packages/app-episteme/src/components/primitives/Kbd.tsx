import type { ReactNode } from "react";

interface KbdProps {
  children: ReactNode;
  className?: string;
}

export function Kbd({ children, className }: KbdProps) {
  const classes = ["ep-kbd", className].filter(Boolean).join(" ");
  return <kbd className={classes}>{children}</kbd>;
}
