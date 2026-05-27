import { FileText } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import { basename, dirpart } from "../pathUtils.ts";
import type { FullTextResult } from "../types.ts";

interface FullTextResultRowProps {
  result: FullTextResult;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}

export function FullTextResultRow({ result, active, onSelect, onHover }: FullTextResultRowProps) {
  const dir = dirpart(result.path);
  return (
    <div
      className={`usearch-result usearch-result--block${active ? " active" : ""}`}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <div className="usearch-result-main">
        <Icon icon={FileText} size="sm" className="usearch-result-icon" />
        <span className="usearch-result-label">{basename(result.path)}</span>
        {dir && <span className="usearch-result-sub">{dir}</span>}
      </div>
      {result.matches.map((m, j) => (
        <div key={j} className="usearch-match-row">
          <span className="usearch-match-line">:{m.line}</span>
          <span className="usearch-match-text">{m.text}</span>
        </div>
      ))}
    </div>
  );
}
