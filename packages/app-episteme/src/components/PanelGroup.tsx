import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { usePanelResize } from "../hooks/usePanelResize.ts";

export interface PanelEntry {
  id: string;
  label: string;
  onClose: () => void;
  content: React.ReactNode;
  defaultWidth?: number;
}

interface PanelGroupProps {
  panels: PanelEntry[];
}

export function PanelGroup({ panels }: PanelGroupProps) {
  const [activeId, setActiveId] = useState<string | null>(panels[0]?.id ?? null);

  // Serialise open panel IDs to detect additions/removals without reference churn
  const panelIdList = panels.map((p) => p.id).join(",");
  const prevPanelIdList = useRef("");

  useEffect(() => {
    const current = new Set(panelIdList ? panelIdList.split(",") : []);
    const prev = new Set(prevPanelIdList.current ? prevPanelIdList.current.split(",") : []);

    let newestNewId: string | null = null;
    for (const id of current) {
      if (!prev.has(id)) newestNewId = id;
    }

    setActiveId((oldId: string | null) => {
      if (newestNewId) return newestNewId;
      if (current.has(oldId ?? "")) return oldId;
      return [...current][0] ?? null;
    });

    prevPanelIdList.current = panelIdList;
  }, [panelIdList]);

  const defaultWidth = panels.find((p) => p.id === activeId)?.defaultWidth ?? 320;
  const { width, handleMouseDown, isDragging } = usePanelResize(defaultWidth, "panel-group");

  if (panels.length === 0) return null;

  const effectiveActive = panels.find((p) => p.id === activeId)?.id ?? panels[0]?.id ?? null;

  return (
    <div
      className="panel-group"
      style={{
        width,
        minWidth: width,
        transition: isDragging ? "none" : undefined,
      }}
    >
      <div className="panel-drag-handle" onMouseDown={handleMouseDown} />

      <div className="panel-group-tabs">
        {panels.map((panel) => (
          <div
            key={panel.id}
            className={`panel-group-tab${panel.id === effectiveActive ? " active" : ""}`}
            onClick={() => setActiveId(panel.id)}
          >
            <span>{panel.label}</span>
            <button
              className="panel-group-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                panel.onClose();
              }}
              title={`Close ${panel.label}`}
            >
              <X size={8} />
            </button>
          </div>
        ))}
      </div>

      <div className="panel-group-content">
        {panels.map((panel) => (
          <div
            key={panel.id}
            style={{
              display: panel.id === effectiveActive ? "flex" : "none",
              flexDirection: "column",
              flex: 1,
              overflow: "hidden",
            }}
          >
            {panel.content}
          </div>
        ))}
      </div>
    </div>
  );
}
