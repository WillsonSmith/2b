import type { ChangeEvent, ReactNode } from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectSize = "sm" | "md";

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<SelectOption>;
  placeholder?: string;
  size?: SelectSize;
  disabled?: boolean;
  invalid?: boolean;
  name?: string;
  id?: string;
  className?: string;
  children?: ReactNode;
}

export function Select({
  value,
  onChange,
  options,
  placeholder,
  size = "md",
  disabled,
  invalid,
  name,
  id,
  className,
}: SelectProps) {
  const handleChange = (e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value);

  const classes = [
    "ep-select",
    `ep-select--${size}`,
    invalid && "ep-select--invalid",
    disabled && "ep-select--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      <select
        className="ep-select__field"
        value={value}
        onChange={handleChange}
        disabled={disabled}
        name={name}
        id={id}
        aria-invalid={invalid || undefined}
      >
        {placeholder != null && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <span className="ep-select__caret" aria-hidden="true">▾</span>
    </span>
  );
}
