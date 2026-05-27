import { useEffect, useRef } from "react";
import { IndentGuides } from "./IndentGuides.tsx";

interface NewItemInputProps {
  depth?: number;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function NewItemInput({
  depth = 0,
  placeholder,
  value,
  onChange,
  onCommit,
  onCancel,
}: NewItemInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const style = depth > 0
    ? { display: "flex", alignItems: "center", paddingLeft: 6, paddingRight: 6 }
    : undefined;

  return (
    <div className="file-tree-new-file" style={style}>
      {depth > 0 && <IndentGuides depth={depth} />}
      <input
        ref={ref}
        className="file-tree-rename-input"
        style={depth > 0 ? { flex: 1, width: "auto" } : undefined}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onCommit}
        placeholder={placeholder}
      />
    </div>
  );
}
