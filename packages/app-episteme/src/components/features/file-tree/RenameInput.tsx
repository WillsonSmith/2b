import { useEffect, useRef } from "react";
import { IndentGuides } from "./IndentGuides.tsx";

interface RenameInputProps {
  depth: number;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function RenameInput({ depth, value, onChange, onCommit, onCancel }: RenameInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div className="file-tree-item active" style={{ paddingLeft: 6 }}>
      <IndentGuides depth={depth} />
      <input
        ref={ref}
        className="file-tree-rename-input"
        style={{ flex: 1, width: "auto" }}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={onCommit}
      />
    </div>
  );
}
