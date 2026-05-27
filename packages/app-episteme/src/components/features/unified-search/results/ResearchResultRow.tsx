import { Globe } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import type { SearchResult } from "../../../../plugins/ResearchPlugin.ts";

interface ResearchResultRowProps {
  result: SearchResult;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}

export function ResearchResultRow({ result, active, onSelect, onHover }: ResearchResultRowProps) {
  return (
    <div
      className={`usearch-result${active ? " active" : ""}`}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <Icon icon={Globe} size="sm" className="usearch-result-icon" />
      <span className="usearch-result-label">{result.title}</span>
      <span className="usearch-result-sub">{result.source}</span>
    </div>
  );
}
