import type { DynamicAgentRecord } from "../../../../types.ts";

export function AgentsPanel({ agents }: { agents: DynamicAgentRecord[] }) {
  if (agents.length === 0) {
    return (
      <div className="panel">
        <div className="panel-empty">No dynamic agents spawned yet.</div>
      </div>
    );
  }
  return (
    <div className="panel">
      {agents.map((a) => (
        <div key={a.name} className="agent-item">
          <div className="agent-header">
            <span className="agent-name">{a.name}</span>
            <span className={`agent-state agent-state--${a.state}`}>
              {a.state}
            </span>
          </div>
          <div className="agent-meta">
            <span className="agent-type">
              {(a as any).type ?? "headless"}
            </span>
            {a.createdAt && (
              <span className="agent-date">
                {new Date(a.createdAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          {(a as any).capabilities && (
            <div className="memory-tags">
              {((a as any).capabilities as string[]).map((cap: string) => (
                <span key={cap} className="tag">
                  {cap}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
