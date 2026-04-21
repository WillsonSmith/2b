import { useCallback, useState } from "react";
import type { RetrievalTrace } from "../../../types.ts";

export function TracePanel() {
  const [trace, setTrace] = useState<RetrievalTrace | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trace/last");
      const data = (await res.json()) as RetrievalTrace | null;
      setTrace(data);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="panel">
      <div className="panel-controls">
        <button className="panel-btn" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "↺ Refresh trace"}
        </button>
      </div>
      {!trace && !loading && (
        <div className="panel-empty">
          Click refresh to load the last retrieval trace.
        </div>
      )}
      {trace && (
        <>
          <div className="panel-section-label">
            Query length: {trace.query_length} chars
          </div>
          {trace.factual.length > 0 && (
            <>
              <div className="panel-section-label">
                Factual memories ({trace.factual.length})
              </div>
              {trace.factual.map((f) => (
                <div key={f.id} className="trace-item">
                  <span className="memory-id">[{f.id.slice(0, 8)}]</span>
                  <span className="behavior-score">
                    sim:{f.score.toFixed(3)}
                  </span>
                </div>
              ))}
            </>
          )}
          {trace.procedure.length > 0 && (
            <>
              <div className="panel-section-label">
                Procedures ({trace.procedure.length})
              </div>
              {trace.procedure.map((p) => (
                <div key={p.id} className="trace-item">
                  <span className="memory-id">[{p.id.slice(0, 8)}]</span>
                  <span className="behavior-score">
                    sim:{p.score.toFixed(3)}
                  </span>
                </div>
              ))}
            </>
          )}
          {trace.recent_thoughts.length > 0 && (
            <>
              <div className="panel-section-label">
                Recent thoughts ({trace.recent_thoughts.length})
              </div>
              {trace.recent_thoughts.map((t) => (
                <div key={t.id} className="trace-item">
                  <span className="memory-id">[{t.id.slice(0, 8)}]</span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
