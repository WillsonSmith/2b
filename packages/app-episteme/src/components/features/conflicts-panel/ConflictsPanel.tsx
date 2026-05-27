import { RotateCw } from "lucide-react";
import { Icon } from "../../primitives/Icon.tsx";
import { IconButton } from "../../primitives/IconButton.tsx";
import { useConflictsCtx } from "../../../state/ConflictsContext.tsx";
import { useSignalValue } from "../../../state/signals.ts";
import { ConflictItem } from "./ConflictItem.tsx";

export function ConflictsPanel() {
  const conflictsGraph = useConflictsCtx();
  const contradictions = useSignalValue(conflictsGraph.contradictions);
  const isLoading = useSignalValue(conflictsGraph.isScanning);

  return (
    <div className="conflicts-panel">
      <div className="conflicts-panel-header">
        <IconButton
          size="sm"
          icon={<Icon icon={RotateCw} size="xs" />}
          aria-label="Re-scan for contradictions"
          onClick={conflictsGraph.handleContradictionScan}
          className="header-icon-btn"
        />
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
              <ConflictItem key={c.id} conflict={c} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
