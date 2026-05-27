import type { KeyboardEvent, Ref } from "react";
import { Search } from "lucide-react";
import { Icon } from "../../primitives/Icon.tsx";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  inputRef?: Ref<HTMLInputElement>;
}

export function SearchInput({ value, onChange, onKeyDown, placeholder, inputRef }: SearchInputProps) {
  return (
    <div className="usearch-input-row">
      <Icon icon={Search} size="sm" className="usearch-input-icon" />
      <input
        ref={inputRef}
        className="usearch-input"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
