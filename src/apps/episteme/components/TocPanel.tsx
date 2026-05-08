import { Loader2, Sparkles, X } from "lucide-react";
import { useDebounce } from "../hooks/useDebounce.ts";
import type { TocEntry } from "../features/toc.ts";

interface TocPanelProps {
  content: string;
  tocEntries: TocEntry[];
  isAnnotating: boolean;
  onAnnotate: () => void;
  onClose: () => void;
}

function extractHeadings(markdown: string): Array<{ level: number; text: string }> {
  return markdown.split("\n").flatMap((line) => {
    const m = line.match(/^(#{1,6})\s+(.+)/);
    return m ? [{ level: m[1]!.length, text: m[2]!.trim() }] : [];
  });
}

function scrollToHeading(text: string): void {
  const headings = document.querySelectorAll(
    ".tiptap h1, .tiptap h2, .tiptap h3, .tiptap h4, .tiptap h5, .tiptap h6",
  );
  for (const el of headings) {
    if (el.textContent?.trim() === text) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      break;
    }
  }
}

export function TocPanel({
  content,
  tocEntries,
  isAnnotating,
  onAnnotate,
  onClose,
}: TocPanelProps) {
  const debouncedContent = useDebounce(content, 600);
  const headings = extractHeadings(debouncedContent);
  const descMap = new Map(tocEntries.map((e) => [e.text, e.description]));

  return (
    <div className="toc-panel">
      <div className="toc-panel-header">
        <span className="toc-panel-title">Contents</span>
        <div className="toc-panel-actions">
          <button
            className="header-icon-btn"
            onClick={onAnnotate}
            disabled={isAnnotating || headings.length === 0}
            title="Add AI descriptions to each section"
          >
            {isAnnotating ? <Loader2 size={13} className="icon-spin" /> : <Sparkles size={13} />}
          </button>
          <button className="header-icon-btn" onClick={onClose} title="Close">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="toc-panel-list">
        {headings.length === 0 ? (
          <div className="toc-empty">
            <p className="toc-empty-title">Table of Contents</p>
            <p className="toc-empty-body">
              Headings in your document appear here as navigation links. Add headings using{" "}
              <code>#</code> syntax or the toolbar, then click any entry to jump to that section.
            </p>
          </div>
        ) : (
          headings.map((h, i) => {
            const desc = descMap.get(h.text);
            return (
              <div
                key={`${h.text}-${i}`}
                className={`toc-entry toc-entry-h${Math.min(h.level, 3)}`}
                onClick={() => scrollToHeading(h.text)}
                title={desc || h.text}
              >
                <div className="toc-entry-heading">{h.text}</div>
                {desc && <div className="toc-entry-desc">{desc}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
