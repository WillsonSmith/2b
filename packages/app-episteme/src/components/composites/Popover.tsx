import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";

export type PopoverPlacement =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  placement?: PopoverPlacement;
  offset?: number;
  children: ReactNode;
  className?: string;
  closeOnEsc?: boolean;
  closeOnOutside?: boolean;
  matchAnchorWidth?: boolean;
}

interface Position {
  top: number;
  left: number;
  width?: number;
}

function computePosition(
  anchor: HTMLElement,
  placement: PopoverPlacement,
  offset: number,
  matchWidth: boolean,
): Position {
  const rect = anchor.getBoundingClientRect();
  const isTop = placement.startsWith("top");
  const isEnd = placement.endsWith("end");
  const top = isTop ? rect.top - offset : rect.bottom + offset;
  const left = isEnd ? rect.right : rect.left;
  return {
    top,
    left,
    width: matchWidth ? rect.width : undefined,
  };
}

export function Popover({
  open,
  onClose,
  anchorRef,
  placement = "bottom-start",
  offset = 4,
  children,
  className,
  closeOnEsc = true,
  closeOnOutside = true,
  matchAnchorWidth = false,
}: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    const update = () => setPos(computePosition(anchor, placement, offset, matchAnchorWidth));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef, placement, offset, matchAnchorWidth]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === "Escape") onClose();
    };
    const handlePointer = (e: PointerEvent) => {
      if (!closeOnOutside) return;
      const target = e.target as Node | null;
      if (popoverRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener("keydown", handleKey);
    document.addEventListener("pointerdown", handlePointer);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.removeEventListener("pointerdown", handlePointer);
    };
  }, [open, onClose, closeOnEsc, closeOnOutside, anchorRef]);

  if (!open || !pos) return null;

  const isEnd = placement.endsWith("end");
  const isTop = placement.startsWith("top");
  const style: CSSProperties = {
    top: pos.top,
    left: pos.left,
    transform: `translate(${isEnd ? "-100%" : "0"}, ${isTop ? "-100%" : "0"})`,
    width: pos.width,
  };

  const classes = ["ep-popover", className].filter(Boolean).join(" ");

  return (
    <div ref={popoverRef} className={classes} style={style} role="dialog">
      {children}
    </div>
  );
}
