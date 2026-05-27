import type { ReactNode } from "react";

interface KeyValueRowProps {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}

export function KeyValueRow({ label, value, className }: KeyValueRowProps) {
  const classes = ["ep-kv-row", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <span className="ep-kv-row__label">{label}</span>
      <span className="ep-kv-row__value">{value}</span>
    </div>
  );
}
