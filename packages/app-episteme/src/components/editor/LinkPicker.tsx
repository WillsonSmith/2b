import { useEffect, useRef } from "react";
import type { LinkSuggestionItem } from "../../features/links.ts";

interface LinkPickerProps {
  top: number;
  left: number;
  query: string;
  onQueryChange: (q: string) => void;
  matches: LinkSuggestionItem[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onAccept: (path: string) => void;
  onClose: () => void;
}

export function LinkPicker({
  top,
  left,
  query,
  onQueryChange,
  matches,
  selectedIndex,
  onHover,
  onAccept,
  onClose,
}: LinkPickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Close when clicking outside the picker
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={pickerRef}
      className="wikilink-popup link-picker"
      style={{ top, left }}
    >
      <input
        ref={inputRef}
        className="link-picker-input"
        type="text"
        placeholder="Search files…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onHover(matches.length === 0 ? 0 : (selectedIndex + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            onHover(matches.length === 0 ? 0 : (selectedIndex - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const item = matches[selectedIndex];
            if (item) onAccept(item.path);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      {matches.map((item, i) => (
        <div
          key={item.path}
          className={`wikilink-popup-item${i === selectedIndex ? " active" : ""}`}
          onMouseEnter={() => onHover(i)}
          // Use mousedown so the click registers before the input blurs
          onMouseDown={(e) => { e.preventDefault(); onAccept(item.path); }}
        >
          <span className="wikilink-popup-name">{item.basename}</span>
          {item.path !== `${item.basename}.md` && (
            <span className="wikilink-popup-path">{item.path}</span>
          )}
        </div>
      ))}
      {matches.length === 0 && query && (
        <div className="wikilink-popup-item" style={{ cursor: "default", opacity: 0.6 }}>
          No matching files
        </div>
      )}
    </div>
  );
}
