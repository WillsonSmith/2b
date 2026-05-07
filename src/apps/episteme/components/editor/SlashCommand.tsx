import type { WikilinkSuggestionItem } from "../../features/wikilinks.ts";

interface WikilinkPopupProps {
  top: number;
  left: number;
  matches: WikilinkSuggestionItem[];
  selectedIndex: number;
  onHover: (index: number) => void;
  onAccept: (basename: string) => void;
}

/**
 * `[[`-triggered popup that suggests workspace files for wikilink completion.
 * Functions as the editor's slash-command-style picker.
 */
export function WikilinkPopup({
  top,
  left,
  matches,
  selectedIndex,
  onHover,
  onAccept,
}: WikilinkPopupProps) {
  return (
    <div
      className="wikilink-popup"
      style={{ top, left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {matches.map((item, i) => (
        <div
          key={item.path}
          className={`wikilink-popup-item${i === selectedIndex ? " active" : ""}`}
          onMouseEnter={() => onHover(i)}
          onClick={() => onAccept(item.basename)}
        >
          <span className="wikilink-popup-name">{item.basename}</span>
          {item.path !== `${item.basename}.md` && (
            <span className="wikilink-popup-path">{item.path}</span>
          )}
        </div>
      ))}
    </div>
  );
}
