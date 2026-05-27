import { FileText } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import { basename, dirpart } from "../pathUtils.ts";

interface FileResultRowProps {
  path: string;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}

export function FileResultRow({ path, active, onSelect, onHover }: FileResultRowProps) {
  const dir = dirpart(path);
  return (
    <div
      className={`usearch-result${active ? " active" : ""}`}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <Icon icon={FileText} size="sm" className="usearch-result-icon" />
      <span className="usearch-result-label">{basename(path)}</span>
      {dir && <span className="usearch-result-sub">{dir}</span>}
    </div>
  );
}
