import type { ReactNode, RefObject } from "react";
import { Popover } from "./Popover.tsx";
import type { PopoverPlacement } from "./Popover.tsx";

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuDivider {
  id: string;
  divider: true;
}

export type MenuEntry = MenuItem | MenuDivider;

interface MenuProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  items: ReadonlyArray<MenuEntry>;
  placement?: PopoverPlacement;
  className?: string;
}

function isDivider(entry: MenuEntry): entry is MenuDivider {
  return "divider" in entry;
}

export function Menu({ open, onClose, anchorRef, items, placement = "bottom-start", className }: MenuProps) {
  const classes = ["ep-menu", className].filter(Boolean).join(" ");

  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} placement={placement} className={classes}>
      <ul className="ep-menu__list" role="menu">
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
    </Popover>
  );
}
