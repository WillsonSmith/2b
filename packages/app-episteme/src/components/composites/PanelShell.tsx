import type { CSSProperties, ReactNode } from "react";

interface PanelShellProps {
  title?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  width?: number | string;
  resizeHandle?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function PanelShell({
  title,
  headerActions,
  children,
  width,
  resizeHandle,
  className,
  style,
}: PanelShellProps) {
  const classes = ["ep-panel-shell", className].filter(Boolean).join(" ");
  const mergedStyle: CSSProperties = {
    ...(width !== undefined ? { width } : {}),
    ...style,
  };

  return (
    <div className={classes} style={mergedStyle}>
      {(title || headerActions) && (
        <div className="ep-panel-shell__header">
          {title && <div className="ep-panel-shell__title">{title}</div>}
          {headerActions && <div className="ep-panel-shell__actions">{headerActions}</div>}
        </div>
      )}
      <div className="ep-panel-shell__body">{children}</div>
      {resizeHandle}
    </div>
  );
}
