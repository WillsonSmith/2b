import type { MouseEvent } from "react";

export type ResizeHandleEdge = "left" | "right";

interface ResizeHandleProps {
  edge?: ResizeHandleEdge;
  onMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
  className?: string;
  "aria-label"?: string;
}

export function ResizeHandle({ edge = "left", onMouseDown, className, ...aria }: ResizeHandleProps) {
  const classes = ["ep-resize-handle", `ep-resize-handle--${edge}`, className].filter(Boolean).join(" ");
  return (
    <div
      className={classes}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label={aria["aria-label"] ?? "Resize"}
    />
  );
}
