import { useRef, useEffect, useCallback } from "react";
import { RotateCw, X } from "lucide-react";
import type { GraphData, GraphNode, GraphLink } from "../features/contradiction.ts";

export type { GraphData, GraphNode, GraphLink };

interface KnowledgeGraphProps {
  onClose: () => void;
  onRefresh: () => void;
  onNodeClick: (file: string) => void;
  graphData: GraphData | null;
  isLoading: boolean;
}

export function KnowledgeGraph({
  onClose,
  onRefresh,
  onNodeClick,
  graphData,
  isLoading,
}: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  const isEmpty = !graphData || (graphData.nodes.length === 0 && graphData.links.length === 0);

  // Mount the force-graph instance once the container is available
  useEffect(() => {
    if (!containerRef.current) return;
    if (isEmpty) return;

    (async () => {
      const ForceGraph = (await import("force-graph")).default;
      if (!containerRef.current) return;

      const el = containerRef.current;
      const g = ForceGraph()(el)
        .backgroundColor("#1a1a1a")
        .nodeRelSize(5)
        .nodeColor((node: GraphNode) => node.color ?? "#5588cc")
        .nodeLabel((node: GraphNode) => node.label ?? "")
        .linkColor((link: GraphLink) => link.color ?? "#555555")
        .linkWidth(1.5)
        .nodeCanvasObjectMode(() => "after")
        .nodeCanvasObject((node: GraphNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
          if (node.x == null || node.y == null) return;
          const label = (node.label ?? "").slice(0, 20);
          const fontSize = Math.max(8, 12 / globalScale);
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillStyle = "#d4d4d4";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(label, node.x, node.y + 7);
        })
        .onNodeClick((node: GraphNode) => {
          if (node.file) onNodeClickRef.current(node.file);
        })
        .width(el.clientWidth || 380)
        .height(el.clientHeight || 480)
        .graphData(graphData ?? { nodes: [], links: [] });

      graphRef.current = g;
    })();

    return () => {
      if (graphRef.current) {
        graphRef.current._destructor?.();
        graphRef.current = null;
      }
      if (containerRef.current) containerRef.current.innerHTML = "";
    };
  // Re-mount when emptiness changes or graphData arrives for the first time
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmpty]);

  // Update data on subsequent changes without remounting
  useEffect(() => {
    if (graphRef.current && graphData && !isEmpty) {
      graphRef.current.graphData(graphData);
    }
  }, [graphData, isEmpty]);

  const handleRefresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <div className="knowledge-graph-panel">
      <div className="knowledge-graph-header">
        <span className="knowledge-graph-title">Knowledge Graph</span>
        <div className="knowledge-graph-legend">
          <span className="kg-legend-dot" style={{ background: "#5588cc" }} /> Files
          <span className="kg-legend-dot" style={{ background: "#666680", marginLeft: 8 }} /> Notes
          <span className="kg-legend-dot" style={{ background: "#cc5555", marginLeft: 8 }} /> Conflicts
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="knowledge-graph-btn" onClick={handleRefresh} title="Refresh graph"><RotateCw size={13} /></button>
          <button className="knowledge-graph-btn" onClick={onClose} title="Close"><X size={13} /></button>
        </div>
      </div>

      <div className="knowledge-graph-body" ref={containerRef}>
        {isLoading && (
          <div className="knowledge-graph-empty">Loading graph…</div>
        )}
        {!isLoading && isEmpty && (
          <div className="knowledge-graph-empty">
            No graph data yet.
            <br />
            <span style={{ fontSize: 11 }}>Index your workspace to populate the graph.</span>
          </div>
        )}
      </div>

      {graphData && !isEmpty && (
        <div className="knowledge-graph-footer">
          {graphData.nodes.length} nodes · {graphData.links.length} links
        </div>
      )}
    </div>
  );
}
