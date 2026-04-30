import { useRef, useCallback } from "react";
import { ForceGraph2D } from "react-force-graph";
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

  const handleNodeClick = useCallback(
    (node: unknown) => {
      const n = node as GraphNode;
      if (n.file) onNodeClick(n.file);
    },
    [onNodeClick],
  );

  const nodeLabel = useCallback((node: GraphNode) => node.label, []);
  const nodeColor = useCallback((node: GraphNode) => node.color, []);
  const linkColor = useCallback((link: GraphLink) => link.color ?? "#555", []);

  const width = containerRef.current?.clientWidth ?? 380;
  const height = containerRef.current?.clientHeight ?? 480;

  const isEmpty = !graphData || (graphData.nodes.length === 0 && graphData.links.length === 0);

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
          <button className="knowledge-graph-btn" onClick={onRefresh} title="Refresh graph">↻</button>
          <button className="knowledge-graph-btn" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      <div className="knowledge-graph-body" ref={containerRef}>
        {isLoading ? (
          <div className="knowledge-graph-empty">Loading graph…</div>
        ) : isEmpty ? (
          <div className="knowledge-graph-empty">
            No graph data yet.
            <br />
            <span style={{ fontSize: 11 }}>Index your workspace to populate the graph.</span>
          </div>
        ) : (
          <ForceGraph2D
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            graphData={graphData as any}
            width={width}
            height={height}
            nodeLabel={nodeLabel as unknown as string}
            nodeColor={nodeColor as unknown as string}
            linkColor={linkColor as unknown as string}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onNodeClick={handleNodeClick as any}
            nodeRelSize={5}
            linkWidth={1.5}
            linkDirectionalParticles={0}
            backgroundColor="#1a1a1a"
            nodeCanvasObjectMode={() => "after"}
            nodeCanvasObject={(node, ctx, globalScale) => {
              const n = node as GraphNode & { x?: number; y?: number };
              if (!n.x || !n.y) return;
              const label = n.label ?? "";
              const fontSize = Math.max(8, 12 / globalScale);
              ctx.font = `${fontSize}px sans-serif`;
              ctx.fillStyle = "#d4d4d4";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(label.slice(0, 20), n.x, n.y + 7);
            }}
          />
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
