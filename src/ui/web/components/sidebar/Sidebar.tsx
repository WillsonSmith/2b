import { useEffect, useState } from "react";
import type {
  BehaviorRecord,
  ConflictRecord,
  ContextualBehaviorRecord,
  PanelId,
} from "../../types.ts";
import type { DynamicAgentRecord } from "../../../types.ts";
import { AgentsPanel } from "./panels/AgentsPanel.tsx";
import { BehaviorsPanel } from "./panels/BehaviorsPanel.tsx";
import { ConflictsPanel } from "./panels/ConflictsPanel.tsx";
import { MemoryPanel } from "./panels/MemoryPanel.tsx";
import { TracePanel } from "./panels/TracePanel.tsx";

export function Sidebar({
  panels,
  conflicts,
  coreBehaviors,
  contextualBehaviors,
  dynamicAgents,
  onDismissConflict,
  onSynthesize,
}: {
  panels: PanelId[];
  conflicts: ConflictRecord[];
  coreBehaviors: BehaviorRecord[];
  contextualBehaviors: ContextualBehaviorRecord[];
  dynamicAgents: DynamicAgentRecord[];
  onDismissConflict: (c: ConflictRecord) => Promise<void>;
  onSynthesize: (c: ConflictRecord) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<PanelId>(panels[0] ?? "memory");

  useEffect(() => {
    if (!panels.includes(activeTab) && panels.length > 0) {
      setActiveTab(panels[0]!);
    }
  }, [panels, activeTab]);

  const tabLabels: Record<PanelId, string> = {
    memory: "Memory",
    behaviors: "Behaviors",
    conflicts: "Conflicts",
    agents: "Agents",
    trace: "Trace",
  };

  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        {panels.map((p) => (
          <button
            key={p}
            className={`sidebar-tab ${activeTab === p ? "sidebar-tab--active" : ""}`}
            onClick={() => setActiveTab(p)}
          >
            {tabLabels[p]}
            {p === "conflicts" && conflicts.length > 0 && (
              <span className="tab-badge">{conflicts.length}</span>
            )}
          </button>
        ))}
      </div>
      <div className="sidebar-content">
        {activeTab === "memory" && <MemoryPanel />}
        {activeTab === "behaviors" && (
          <BehaviorsPanel
            core={coreBehaviors}
            contextual={contextualBehaviors}
          />
        )}
        {activeTab === "conflicts" && (
          <ConflictsPanel
            conflicts={conflicts}
            onDismiss={onDismissConflict}
            onSynthesize={onSynthesize}
          />
        )}
        {activeTab === "agents" && <AgentsPanel agents={dynamicAgents} />}
        {activeTab === "trace" && <TracePanel />}
      </div>
    </div>
  );
}
