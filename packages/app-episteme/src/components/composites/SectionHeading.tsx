import type { ReactNode } from "react";

interface SectionHeadingProps {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export function SectionHeading({ children, trailing, className }: SectionHeadingProps) {
  const classes = ["ep-section-heading", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <span className="ep-section-heading__label">{children}</span>
      {trailing && <span className="ep-section-heading__trailing">{trailing}</span>}
    </div>
  );
}
