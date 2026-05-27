import { ArrowLeft } from "lucide-react";
import { Icon } from "../../primitives/Icon.tsx";
import { SECTIONS } from "./constants.ts";
import type { SettingsSection } from "./types.ts";

interface SettingsNavProps {
  active: SettingsSection;
  onChange: (section: SettingsSection) => void;
  onBack: () => void;
}

export function SettingsNav({ active, onChange, onBack }: SettingsNavProps) {
  return (
    <nav className="settings-nav" aria-label="Settings sections">
      <button
        type="button"
        className="settings-back-btn"
        onClick={onBack}
        title="Close settings (Esc)"
      >
        <Icon icon={ArrowLeft} size="sm" />
        <span>Back</span>
      </button>
      <ul className="settings-nav-list">
        {SECTIONS.map(({ id, label }) => (
          <li key={id} className={active === id ? "active" : ""}>
            <button type="button" onClick={() => onChange(id)}>
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
