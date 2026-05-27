import type { MouseEvent, ReactNode } from "react";

interface ListRowProps {
  icon?: ReactNode;
  main: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  onContextMenu?: (e: MouseEvent<HTMLDivElement>) => void;
  className?: string;
  title?: string;
}

export function ListRow({
  icon,
  main,
  meta,
  actions,
  selected = false,
  disabled = false,
  onClick,
  onContextMenu,
  className,
  title,
}: ListRowProps) {
  const classes = [
    "ep-list-row",
    selected && "ep-list-row--selected",
    disabled && "ep-list-row--disabled",
    onClick && "ep-list-row--clickable",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    onClick?.(e);
  };

  return (
    <div
      className={classes}
      role={onClick ? "button" : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      onClick={handleClick}
      onContextMenu={onContextMenu}
      title={title}
      aria-selected={selected || undefined}
      aria-disabled={disabled || undefined}
    >
      {icon && <span className="ep-list-row__icon">{icon}</span>}
      <span className="ep-list-row__main">{main}</span>
      {meta && <span className="ep-list-row__meta">{meta}</span>}
      {actions && <span className="ep-list-row__actions">{actions}</span>}
    </div>
  );
}
