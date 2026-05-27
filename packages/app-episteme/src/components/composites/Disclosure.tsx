import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Icon } from "../primitives/Icon.tsx";

interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  icon?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function Disclosure({
  summary,
  children,
  open: openProp,
  defaultOpen = false,
  onToggle,
  icon,
  meta,
  className,
}: DisclosureProps) {
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = isControlled ? openProp : internalOpen;

  const toggle = () => {
    const next = !open;
    if (!isControlled) setInternalOpen(next);
    onToggle?.(next);
  };

  const classes = [
    "ep-disclosure",
    open && "ep-disclosure--open",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <button
        type="button"
        className="ep-disclosure__summary"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon icon={ChevronRight} size="sm" className="ep-disclosure__chevron" />
        {icon && <span className="ep-disclosure__icon">{icon}</span>}
        <span className="ep-disclosure__label">{summary}</span>
        {meta && <span className="ep-disclosure__meta">{meta}</span>}
      </button>
      {open && <div className="ep-disclosure__content">{children}</div>}
    </div>
  );
}
