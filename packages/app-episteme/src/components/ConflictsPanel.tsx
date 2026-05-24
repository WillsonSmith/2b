import { RotateCw } from "lucide-react";
import type { ContradictionRecord } from "../plugins/ContradictionPlugin.ts";
import { useConflictsCtx } from "../state/ConflictsContext.tsx";
import { useSignalValue } from "../state/signals.ts";

export type { ContradictionRecord };

export function ConflictsPanel() {
  const conflictsGraph = useConflictsCtx();
  const contradictions = useSignalValue(conflictsGraph.contradictions);
  const isLoading = useSignalValue(conflictsGraph.isScanning);
  const onRefresh = conflictsGraph.handleContradictionScan;
  return (
    <div className="conflicts-panel">
      <div className="conflicts-panel-header">
        <button className="header-icon-btn" onClick={onRefresh} title="Re-scan for contradictions">
          <RotateCw size={13} />
        </button>
      </div>

      <div className="conflicts-content">
        {isLoading ? (
          <div className="conflicts-empty">Scanning for contradictions…</div>
        ) : contradictions.length === 0 ? (
          <div className="conflicts-empty">
            No contradictions found.
            <br />
            <span style={{ fontSize: 11 }}>
              Click the refresh icon to run a scan across your workspace notes.
            </span>
          </div>
        ) : (
          <ul className="conflicts-list">
            {contradictions.map((c) => (
              <li key={c.id} className="conflict-item">
                <div className="conflict-summary">{c.summary}</div>
                <div className="conflict-sources">
                  <div className="conflict-source conflict-source-a">
                    <span className="conflict-source-label">A</span>
                    <span className="conflict-source-text">{c.sourceAText}</span>
                  </div>
                  <div className="conflict-source conflict-source-b">
                    <span className="conflict-source-label">B</span>
                    <span className="conflict-source-text">{c.sourceBText}</span>
                  </div>
                </div>
                <div className="conflict-meta">
                  {new Date(c.timestamp).toLocaleDateString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
