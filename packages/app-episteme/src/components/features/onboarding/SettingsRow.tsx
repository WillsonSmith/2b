import type { ReactNode } from "react";

interface SettingsRowProps {
  name: ReactNode;
  description?: ReactNode;
  control: ReactNode;
}

export function SettingsRow({ name, description, control }: SettingsRowProps) {
  return (
    <div className="model-config-row">
      <div className="model-config-label">
        <span className="model-config-name">{name}</span>
        {description != null && <span className="model-config-desc">{description}</span>}
      </div>
      {control}
    </div>
  );
}
