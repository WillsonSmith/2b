import type { ContradictionRecord } from "../../../plugins/ContradictionPlugin.ts";

interface ConflictItemProps {
  conflict: ContradictionRecord;
}

export function ConflictItem({ conflict }: ConflictItemProps) {
  return (
    <li className="conflict-item">
      <div className="conflict-summary">{conflict.summary}</div>
      <div className="conflict-sources">
        <div className="conflict-source conflict-source-a">
          <span className="conflict-source-label">A</span>
          <span className="conflict-source-text">{conflict.sourceAText}</span>
        </div>
        <div className="conflict-source conflict-source-b">
          <span className="conflict-source-label">B</span>
          <span className="conflict-source-text">{conflict.sourceBText}</span>
        </div>
      </div>
      <div className="conflict-meta">
        {new Date(conflict.timestamp).toLocaleDateString()}
      </div>
    </li>
  );
}
