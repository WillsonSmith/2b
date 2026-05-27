import { Terminal } from "lucide-react";
import { Icon } from "../../../primitives/Icon.tsx";
import type { SearchCommand } from "../types.ts";

interface CommandResultRowProps {
  command: SearchCommand;
  active: boolean;
  onSelect: () => void;
  onHover: () => void;
}

export function CommandResultRow({ command, active, onSelect, onHover }: CommandResultRowProps) {
  return (
    <div
      className={`usearch-result${active ? " active" : ""}`}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      <Icon icon={Terminal} size="sm" className="usearch-result-icon" />
      <span className="usearch-result-label">{command.label}</span>
      {command.description && (
        <span className="usearch-result-sub">{command.description}</span>
      )}
    </div>
  );
}
