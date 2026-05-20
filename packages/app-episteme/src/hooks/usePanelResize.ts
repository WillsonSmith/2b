import { useCallback, useEffect, useRef, useState } from "react";

export function usePanelResize(
  initialWidth: number,
  storageKey?: string,
  options: { direction?: "left" | "right" } = {},
) {
  const direction = options.direction ?? "left";
  const [width, setWidth] = useState(() => {
    if (storageKey) {
      const stored = localStorage.getItem(`panel-width-${storageKey}`);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (!isNaN(parsed) && parsed > 80) return parsed;
      }
    }
    return initialWidth;
  });

  const [isDragging, setIsDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = widthRef.current;
    setIsDragging(true);

    function onMouseMove(ev: MouseEvent) {
      // Left-edge handle: dragging left expands. Right-edge handle: dragging right expands.
      const delta = direction === "left" ? startX - ev.clientX : ev.clientX - startX;
      const newWidth = Math.max(120, startWidth + delta);
      setWidth(newWidth);
    }

    function onMouseUp() {
      setIsDragging(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [direction]);

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(`panel-width-${storageKey}`, String(width));
    }
  }, [width, storageKey]);

  return { width, handleMouseDown, isDragging };
}
