import { Loader2, Sparkles, Clock } from "lucide-react";
import { useDebounce } from "../hooks/useDebounce.ts";
import type { TocEntry } from "../features/toc.ts";
import { sectionHash } from "../features/tocHash.ts";

interface TocPanelProps {
  content: string;
  tocEntries: TocEntry[];
  isAnnotating: boolean;
  onAnnotate: () => void;
}

interface HeadingData {
  level: number;
  text: string;
  contentHash: string;
}

function extractHeadingData(markdown: string): HeadingData[] {
  const lines = markdown.split("\n");
  const result: HeadingData[] = [];
  let current: { level: number; text: string } | null = null;
  let content = "";

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)/);
    if (m) {
      if (current) {
        result.push({ ...current, contentHash: sectionHash(current.text, content) });
      }
      current = { level: m[1]!.length, text: m[2]!.trim() };
      content = "";
    } else if (current && line.trim()) {
      content += line + " ";
    }
  }
  if (current) {
    result.push({ ...current, contentHash: sectionHash(current.text, content) });
  }
  return result;
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
}: TocPanelProps) {
  const debouncedContent = useDebounce(content, 600);
  const headings = extractHeadingData(debouncedContent);

  const storedMap = new Map(
    tocEntries.map((e) => [e.text, { description: e.description, contentHash: e.contentHash }]),
  );

  return (
    <div className="toc-panel">
      <button
        className="toc-panel-annotate-btn header-icon-btn"
        onClick={onAnnotate}
        disabled={isAnnotating || headings.length === 0}
        title="Add AI descriptions to each section"
      >
        {isAnnotating ? <Loader2 size={13} className="icon-spin" /> : <Sparkles size={13} />}
      </button>

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
            const stored = storedMap.get(h.text);
            const isStale =
              stored?.contentHash !== undefined && stored.contentHash !== h.contentHash;

            return (
              <div
                key={`${h.text}-${i}`}
                className={`toc-entry toc-entry-h${Math.min(h.level, 3)}`}
                onClick={() => scrollToHeading(h.text)}
                title={stored?.description || h.text}
              >
                <div className="toc-entry-heading">{h.text}</div>
                {stored?.description && (
                  <div className={`toc-entry-desc${isStale ? " stale" : ""}`}>
                    {stored.description}
                    {isStale && (
                      <span className="toc-entry-stale-icon" title="Description may be outdated">
                        <Clock size={10} />
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
