import { Clock } from "lucide-react";
import { Icon } from "../../primitives/Icon.tsx";
import type { HeadingData } from "./tocHeadings.ts";

interface TocEntryProps {
  heading: HeadingData;
  description?: string;
  isStale: boolean;
  onClick: () => void;
}

export function TocEntry({ heading, description, isStale, onClick }: TocEntryProps) {
  const level = Math.min(heading.level, 3);
  return (
    <div
      className={`toc-entry toc-entry-h${level}`}
      onClick={onClick}
      title={description || heading.text}
    >
      <div className="toc-entry-heading">{heading.text}</div>
      {description && (
        <div className={`toc-entry-desc${isStale ? " stale" : ""}`}>
          {description}
          {isStale && (
            <span className="toc-entry-stale-icon" title="Description may be outdated">
              <Icon icon={Clock} size="xs" />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
