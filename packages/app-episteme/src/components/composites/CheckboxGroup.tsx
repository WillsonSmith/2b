import type { ReactNode } from "react";
import { Checkbox } from "../primitives/Checkbox.tsx";

export interface CheckboxGroupOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export type CheckboxGroupOrientation = "horizontal" | "vertical";

interface CheckboxGroupProps<T extends string = string> {
  value: ReadonlyArray<T>;
  onChange: (value: ReadonlyArray<T>) => void;
  options: ReadonlyArray<CheckboxGroupOption<T>>;
  orientation?: CheckboxGroupOrientation;
  className?: string;
}

export function CheckboxGroup<T extends string = string>({
  value,
  onChange,
  options,
  orientation = "vertical",
  className,
}: CheckboxGroupProps<T>) {
  const classes = [
    "ep-checkbox-group",
    `ep-checkbox-group--${orientation}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const toggle = (val: T, checked: boolean) => {
    const set = new Set(value);
    if (checked) set.add(val);
    else set.delete(val);
    onChange(Array.from(set));
  };

  return (
    <div role="group" className={classes}>
      {options.map((opt) => (
        <Checkbox
          key={opt.value}
          checked={value.includes(opt.value)}
          disabled={opt.disabled}
          label={opt.label}
          onChange={(checked) => toggle(opt.value, checked)}
        />
      ))}
    </div>
  );
}
