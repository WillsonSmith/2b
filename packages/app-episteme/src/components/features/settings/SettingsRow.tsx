import type { CSSProperties, ReactNode } from "react";

interface SettingsRowProps {
  name: ReactNode;
  description?: ReactNode;
  control: ReactNode;
  trailing?: ReactNode;
  indent?: boolean;
  style?: CSSProperties;
}

export function SettingsRow({ name, description, control, trailing, indent, style }: SettingsRowProps) {
  const rowStyle: CSSProperties = {
    marginBottom: 4,
    ...(indent ? { paddingLeft: 20 } : {}),
    ...style,
  };
  return (
    <div className="model-config-row" style={rowStyle}>
      <div className="model-config-label">
        <span className="model-config-name">{name}</span>
        {description != null && <span className="model-config-desc">{description}</span>}
      </div>
      {trailing}
      {control}
    </div>
  );
}
