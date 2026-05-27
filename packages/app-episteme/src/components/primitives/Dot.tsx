export type DotTone = "neutral" | "info" | "warn" | "danger" | "success" | "muted";

interface DotProps {
  tone?: DotTone;
  pulse?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function Dot({ tone = "neutral", pulse = false, className, ...aria }: DotProps) {
  const classes = [
    "ep-dot",
    `ep-dot--${tone}`,
    pulse && "ep-dot--pulse",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={classes}
      role={aria["aria-label"] ? "status" : undefined}
      aria-label={aria["aria-label"]}
      aria-hidden={aria["aria-label"] ? undefined : true}
    />
  );
}
