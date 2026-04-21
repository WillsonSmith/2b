import type { ActiveTool, AgentState, DynamicAgentRecord } from "../../../types.ts";

export function StatusArea({
  state,
  activeTools,
  dynamicAgents,
}: {
  state: AgentState;
  activeTools: ActiveTool[];
  dynamicAgents: DynamicAgentRecord[];
}) {
  const isThinking = state === "thinking";
  const activeAgents = dynamicAgents.filter((a) => a.state !== "idle");

  return (
    <div className="status">
      <div className="status-line">
        <span style={{ color: "var(--cyan)", fontWeight: "bold" }}>2b</span>
        <span
          className={`status-indicator status-indicator--${isThinking ? "thinking" : "ready"}`}
        >
          {isThinking ? (
            <>
              <span className="spinner">⟳</span>
              {activeTools.length === 0
                ? "thinking"
                : `${activeTools.length} tool${activeTools.length > 1 ? "s" : ""} running`}
            </>
          ) : (
            "ready"
          )}
        </span>
      </div>

      {isThinking && activeTools.length > 0 && (
        <div className="status-tools">
          {activeTools.map((tool, i) => (
            <div key={i} className="status-tool">
              [{tool.agentName ?? tool.name}]
              {tool.currentSubTool && (
                <>
                  {" "}
                  →{" "}
                  <span className="status-tool-sub">{tool.currentSubTool}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {activeAgents.length > 0 && (
        <div className="status-agents">
          {activeAgents.map((a) => (
            <div
              key={a.name}
              className={`status-agent ${a.state === "error" ? "status-agent--error" : ""}`}
            >
              [{a.name}] {a.state}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
