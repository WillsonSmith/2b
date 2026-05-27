import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { MenuEntry } from "./Menu.tsx";

interface ContextMenuProps {
  open: boolean;
  onClose: () => void;
  x: number;
  y: number;
  items: ReadonlyArray<MenuEntry>;
  className?: string;
}

function isDivider(entry: MenuEntry): entry is Extract<MenuEntry, { divider: true }> {
  return "divider" in entry;
}

export function ContextMenu({ open, onClose, x, y, items, className }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handlePointer = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node | null)) return;
      onClose();
    };
    window.addEventListener("keydown", handleKey);
    document.addEventListener("pointerdown", handlePointer);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.removeEventListener("pointerdown", handlePointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  const style: CSSProperties = { top: y, left: x };
  const classes = ["ep-menu", "ep-context-menu", className].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={classes} style={style} role="menu">
      <ul className="ep-menu__list">
        {items.map((entry) => {
          if (isDivider(entry)) {
            return <li key={entry.id} className="ep-menu__divider" role="separator" />;
          }
          const itemClasses = [
            "ep-menu__item",
            entry.danger && "ep-menu__item--danger",
            entry.disabled && "ep-menu__item--disabled",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <li key={entry.id} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                className={itemClasses}
                onClick={() => {
                  if (entry.disabled) return;
                  entry.onSelect();
                  onClose();
                }}
              >
                {entry.icon && <span className="ep-menu__icon">{entry.icon}</span>}
                <span className="ep-menu__label">{entry.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
