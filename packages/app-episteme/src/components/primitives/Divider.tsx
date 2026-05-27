export type DividerOrientation = "horizontal" | "vertical";

interface DividerProps {
  orientation?: DividerOrientation;
  className?: string;
}

export function Divider({ orientation = "horizontal", className }: DividerProps) {
  const classes = ["ep-divider", `ep-divider--${orientation}`, className]
    .filter(Boolean)
    .join(" ");
  return <hr className={classes} role="separator" aria-orientation={orientation} />;
}
