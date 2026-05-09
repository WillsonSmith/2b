import { RotateCw, Loader2 } from "lucide-react";
import type { TocEntry } from "../features/toc.ts";

interface OutlinePanelProps {
  entries: TocEntry[];
  isGenerating: boolean;
  onGenerate: () => void;
  onHeadingClick: (id: string, text: string) => void;
}

export function OutlinePanel({
  entries,
  isGenerating,
  onGenerate,
  onHeadingClick,
}: OutlinePanelProps) {
  return (
    <div className="outline-panel">
      <div className="outline-panel-header">
        <span>Outline</span>
        <button
          className="outline-refresh-btn"
          onClick={onGenerate}
          disabled={isGenerating}
          title="Generate narrative outline"
        >
          {isGenerating ? <Loader2 size={13} className="icon-spin" /> : <RotateCw size={13} />}
        </button>
      </div>

      <div className="outline-panel-list">
        {entries.length === 0 ? (
          <div className="outline-empty">
            {isGenerating ? "Generating outline…" : "No headings found. Click the refresh icon to generate."}
          </div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={`${entry.id}-${i}`}
              className={`outline-entry outline-entry-h${Math.min(entry.level, 3)}`}
              onClick={() => onHeadingClick(entry.id, entry.text)}
              title={entry.description || entry.text}
            >
              <div className="outline-entry-heading">{entry.text}</div>
              {entry.description && (
                <div className="outline-entry-desc">{entry.description}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
