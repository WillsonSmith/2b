interface MentionDropdownProps {
  matches: ReadonlyArray<string>;
  activeIndex: number;
  onHover: (i: number) => void;
  onPick: (filename: string) => void;
}

export function MentionDropdown({ matches, activeIndex, onHover, onPick }: MentionDropdownProps) {
  if (matches.length === 0) return null;
  return (
    <div className="ep-sidecar__mention-dropdown" role="listbox">
      {matches.map((f, i) => {
        const short = f.split("/").at(-1) ?? f;
        const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
        const active = i === activeIndex;
        return (
          <button
            key={f}
            type="button"
            role="option"
            aria-selected={active}
            className={`ep-sidecar__mention-item${active ? " ep-sidecar__mention-item--active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(f);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span className="ep-sidecar__mention-name">{short}</span>
            {dir && <span className="ep-sidecar__mention-dir">{dir}</span>}
          </button>
        );
      })}
    </div>
  );
}
