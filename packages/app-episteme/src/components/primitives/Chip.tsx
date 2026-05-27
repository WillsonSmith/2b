import type { MouseEvent, ReactNode } from "react";
import { X } from "lucide-react";
import { Icon } from "./Icon.tsx";

export type ChipTone = "neutral" | "info" | "warn" | "danger" | "success";

interface ChipProps {
  tone?: ChipTone;
  children: ReactNode;
  iconLeft?: ReactNode;
  onRemove?: () => void;
  onClick?: (e: MouseEvent<HTMLSpanElement>) => void;
  className?: string;
  title?: string;
}

export function Chip({ tone = "neutral", children, iconLeft, onRemove, onClick, className, title }: ChipProps) {
  const classes = [
    "ep-chip",
    `ep-chip--${tone}`,
    onClick && "ep-chip--clickable",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} onClick={onClick} title={title}>
      {iconLeft && <span className="ep-chip__icon">{iconLeft}</span>}
      <span className="ep-chip__label">{children}</span>
      {onRemove && (
        <button
          type="button"
          className="ep-chip__remove"
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Icon icon={X} size="xs" />
        </button>
      )}
    </span>
  );
}
