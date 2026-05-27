import type { ChangeEvent, ReactNode } from "react";

interface RadioProps {
  checked: boolean;
  onChange: (value: string) => void;
  name: string;
  value: string;
  label?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Radio({ checked, onChange, name, value, label, disabled, id, className }: RadioProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value);

  const wrapperClasses = [
    "ep-radio",
    disabled && "ep-radio--disabled",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <label className={wrapperClasses}>
      <input
        type="radio"
        checked={checked}
        onChange={handleChange}
        name={name}
        value={value}
        disabled={disabled}
        id={id}
        className="ep-radio__input"
      />
      <span className="ep-radio__dot" aria-hidden="true" />
      {label != null && <span className="ep-radio__label">{label}</span>}
    </label>
  );
}
