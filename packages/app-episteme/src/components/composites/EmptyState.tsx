import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  const classes = ["ep-empty-state", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {icon && <div className="ep-empty-state__icon">{icon}</div>}
      {title && <div className="ep-empty-state__title">{title}</div>}
      {description && <div className="ep-empty-state__description">{description}</div>}
      {action && <div className="ep-empty-state__action">{action}</div>}
    </div>
  );
}
