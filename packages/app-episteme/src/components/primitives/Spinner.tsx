import { Loader2 } from "lucide-react";
import { Icon } from "./Icon.tsx";
import type { IconSize } from "./Icon.tsx";

interface SpinnerProps {
  size?: IconSize;
  className?: string;
  "aria-label"?: string;
}

export function Spinner({ size = "md", className, ...aria }: SpinnerProps) {
  const classes = ["ep-spinner", className].filter(Boolean).join(" ");
  return (
    <Icon
      icon={Loader2}
      size={size}
      className={classes}
      aria-label={aria["aria-label"] ?? "Loading"}
    />
  );
}
