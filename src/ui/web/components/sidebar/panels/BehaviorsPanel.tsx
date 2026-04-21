import type {
  BehaviorRecord,
  ContextualBehaviorRecord,
} from "../../../types.ts";

export function BehaviorsPanel({
  core,
  contextual,
}: {
  core: BehaviorRecord[];
  contextual: ContextualBehaviorRecord[];
}) {
  return (
    <div className="panel">
      {core.length === 0 && contextual.length === 0 && (
        <div className="panel-empty">
          No behaviors loaded yet. Send a message to trigger behavior
          retrieval.
        </div>
      )}
      {core.length > 0 && (
        <>
          <div className="panel-section-label">
            Always active ({core.length})
          </div>
          {core.map((b) => (
            <div key={b.id} className="behavior-item behavior-item--core">
              <div className="behavior-meta">
                <span className="memory-id">[{b.id.slice(0, 8)}]</span>
                <span className="memory-weight">w:{b.weight.toFixed(1)}</span>
              </div>
              <div className="behavior-text">{b.text}</div>
            </div>
          ))}
        </>
      )}
      {contextual.length > 0 && (
        <>
          <div className="panel-section-label">
            This turn ({contextual.length})
          </div>
          {contextual.map((b) => (
            <div key={b.id} className="behavior-item">
              <div className="behavior-meta">
                <span className="memory-id">[{b.id.slice(0, 8)}]</span>
                <span className="memory-weight">w:{b.weight.toFixed(1)}</span>
                <span className="behavior-score">
                  sim:{b.score.toFixed(2)}
                </span>
              </div>
              <div className="behavior-text">{b.text}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
