import { useState } from "react";
import type { ConflictRecord } from "../../../types.ts";

export function ConflictsPanel({
  conflicts,
  onDismiss,
  onSynthesize,
}: {
  conflicts: ConflictRecord[];
  onDismiss: (c: ConflictRecord) => Promise<void>;
  onSynthesize: (c: ConflictRecord) => Promise<void>;
}) {
  const [synthesizing, setSynthesizing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const handleSynthesize = async (c: ConflictRecord) => {
    const key = `${c.newId}::${c.conflictId}`;
    setSynthesizing(key);
    try {
      const res = await fetch("/api/behaviors/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_a: c.newId, id_b: c.conflictId }),
      });
      const data = (await res.json()) as { result?: string; error?: string };
      setResults((prev) => ({
        ...prev,
        [key]: data.result ?? data.error ?? "Done.",
      }));
      await onSynthesize(c);
    } catch (e) {
      setResults((prev) => ({ ...prev, [key]: String(e) }));
    } finally {
      setSynthesizing(null);
    }
  };

  if (conflicts.length === 0) {
    return (
      <div className="panel">
        <div className="panel-empty">No pending conflicts.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      {conflicts.map((c) => {
        const key = `${c.newId}::${c.conflictId}`;
        const isBusy = synthesizing === key;
        const result = results[key];
        return (
          <div key={key} className="conflict-item">
            <div className="conflict-score">
              Similarity: {(c.score * 100).toFixed(0)}%
            </div>
            <div className="conflict-pair">
              <div className="conflict-behavior">
                <span className="conflict-label">New</span>
                <span className="memory-id">[{c.newId.slice(0, 8)}]</span>
                <div className="conflict-text">{c.newText}</div>
              </div>
              <div className="conflict-behavior">
                <span className="conflict-label">Conflicts with</span>
                <span className="memory-id">
                  [{c.conflictId.slice(0, 8)}]
                </span>
                <div className="conflict-text">{c.conflictText}</div>
              </div>
            </div>
            {result && <div className="conflict-result">{result}</div>}
            {!result && (
              <div className="conflict-actions">
                <button
                  className="panel-btn panel-btn--green"
                  onClick={() => handleSynthesize(c)}
                  disabled={isBusy}
                >
                  {isBusy ? "Synthesizing…" : "Synthesize"}
                </button>
                <button
                  className="panel-btn"
                  onClick={() => onDismiss(c)}
                  disabled={isBusy}
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
