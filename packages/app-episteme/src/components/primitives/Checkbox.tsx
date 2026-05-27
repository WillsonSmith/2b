import type { ChangeEvent, ReactNode } from "react";

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
}

export function Checkbox({ checked, onChange, label, disabled, name, id, className }: CheckboxProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked);

  const wrapperClasses = [
    "ep-checkbox",
    disabled && "ep-checkbox--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={wrapperClasses}>
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        name={name}
        id={id}
        className="ep-checkbox__input"
      />
      <span className="ep-checkbox__box" aria-hidden="true" />
      {label != null && <span className="ep-checkbox__label">{label}</span>}
    </label>
  );
}
