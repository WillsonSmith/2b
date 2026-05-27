import type { CSSProperties, ReactNode, UIEvent, Ref } from "react";

export type ScrollAxis = "y" | "x" | "both";

interface ScrollAreaProps {
  axis?: ScrollAxis;
  className?: string;
  children?: ReactNode;
  style?: CSSProperties;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  scrollRef?: Ref<HTMLDivElement>;
}

export function ScrollArea({ axis = "y", className, children, style, onScroll, scrollRef }: ScrollAreaProps) {
  const classes = ["ep-scroll", `ep-scroll--${axis}`, className].filter(Boolean).join(" ");
  return (
    <div ref={scrollRef} className={classes} style={style} onScroll={onScroll}>
      {children}
    </div>
  );
}
