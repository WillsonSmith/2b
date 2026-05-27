import type { ReactNode } from "react";
import { Spinner } from "../primitives/Spinner.tsx";
import type { IconSize } from "../primitives/Icon.tsx";

interface InlineLoadingProps {
  children?: ReactNode;
  size?: IconSize;
  className?: string;
}

export function InlineLoading({ children = "Loading…", size = "sm", className }: InlineLoadingProps) {
  const classes = ["ep-inline-loading", className].filter(Boolean).join(" ");
  return (
    <span className={classes} role="status" aria-live="polite">
      <Spinner size={size} />
      {children && <span className="ep-inline-loading__label">{children}</span>}
    </span>
  );
}
