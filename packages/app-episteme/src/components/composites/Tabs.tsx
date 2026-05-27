import type { ReactNode } from "react";

export interface TabDef<TId extends string = string> {
  id: TId;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

interface TabsProps<TId extends string = string> {
  tabs: ReadonlyArray<TabDef<TId>>;
  value: TId;
  onChange: (id: TId) => void;
  ariaLabel?: string;
  className?: string;
}

export function Tabs<TId extends string = string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  className,
}: TabsProps<TId>) {
  const classes = ["ep-tabs", className].filter(Boolean).join(" ");
  return (
    <div role="tablist" aria-label={ariaLabel} className={classes}>
      {tabs.map((tab) => {
        const active = tab.id === value;
        const tabClasses = [
          "ep-tabs__tab",
          active && "ep-tabs__tab--active",
          tab.disabled && "ep-tabs__tab--disabled",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={tab.disabled}
            className={tabClasses}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon && <span className="ep-tabs__icon">{tab.icon}</span>}
            <span className="ep-tabs__label">{tab.label}</span>
            {tab.badge != null && <span className="ep-tabs__badge">{tab.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
