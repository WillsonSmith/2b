import type { ChangeEvent } from "react";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function ToggleSwitch({ checked, onChange, disabled, ariaLabel }: ToggleSwitchProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked);
  return (
    <label className="settings-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <span className="settings-toggle-track" />
    </label>
  );
}
