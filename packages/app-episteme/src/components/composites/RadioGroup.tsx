import type { ReactNode } from "react";
import { Radio } from "../primitives/Radio.tsx";

export interface RadioGroupOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export type RadioGroupOrientation = "horizontal" | "vertical";

interface RadioGroupProps<T extends string = string> {
  name: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<RadioGroupOption<T>>;
  orientation?: RadioGroupOrientation;
  className?: string;
}

export function RadioGroup<T extends string = string>({
  name,
  value,
  onChange,
  options,
  orientation = "vertical",
  className,
}: RadioGroupProps<T>) {
  const classes = [
    "ep-radio-group",
    `ep-radio-group--${orientation}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div role="radiogroup" className={classes}>
      {options.map((opt) => (
        <Radio
          key={opt.value}
          name={name}
          value={opt.value}
          checked={opt.value === value}
          disabled={opt.disabled}
          label={opt.label}
          onChange={(next) => onChange(next as T)}
        />
      ))}
    </div>
  );
}
