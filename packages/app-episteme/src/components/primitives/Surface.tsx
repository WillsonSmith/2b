import type { CSSProperties, ReactNode } from "react";

export type SurfaceElevation = "flat" | "low" | "raised";
export type SurfacePadding = "none" | "sm" | "md" | "lg";

interface SurfaceProps {
  elevation?: SurfaceElevation;
  padding?: SurfacePadding;
  bordered?: boolean;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Surface({
  elevation = "flat",
  padding = "md",
  bordered = false,
  className,
  children,
  style,
}: SurfaceProps) {
  const classes = [
    "ep-surface",
    `ep-surface--elev-${elevation}`,
    `ep-surface--pad-${padding}`,
    bordered && "ep-surface--bordered",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} style={style}>
      {children}
    </div>
  );
}
