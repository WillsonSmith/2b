interface ColorSwatchGroupProps {
  value: string;
  onChange: (value: string) => void;
  onReset?: () => void;
  customized?: boolean;
  title?: string;
}

export function ColorSwatchGroup({ value, onChange, onReset, customized, title }: ColorSwatchGroupProps) {
  return (
    <div className="color-swatch-group" title={title ?? "Highlight color (auto-adjusts for theme)"}>
      <input
        type="color"
        className="color-swatch"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {customized && onReset && (
        <button
          type="button"
          className="color-swatch-reset"
          title="Reset to default"
          onClick={onReset}
        >
          ↺
        </button>
      )}
    </div>
  );
}
