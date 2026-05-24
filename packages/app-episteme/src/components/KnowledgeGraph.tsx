import { useRef, useEffect, useCallback } from "react";
import { FolderSync, RotateCw } from "lucide-react";
import type { GraphData, GraphNode, GraphLink } from "../plugins/WorkspacePlugin.ts";
import { useConflictsCtx } from "../state/ConflictsContext.tsx";
import { useSignalValue } from "../state/signals.ts";

export type { GraphData, GraphNode, GraphLink };

interface GraphPalette {
  bg: string;
  text: string;
  node: string;
  link: string;
}

function readPalette(): GraphPalette {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    bg: read("--bg", "#181818"),
    text: read("--text", "#d4d4d4"),
    node: read("--graph-node-file", "#5588cc"),
    link: read("--graph-link-wiki", "#55cc88"),
  };
}

export function KnowledgeGraph() {
  const conflictsGraph = useConflictsCtx();
  const graphData = useSignalValue(conflictsGraph.graphData);
  const pagination = useSignalValue(conflictsGraph.graphPagination);
  const isLoading = useSignalValue(conflictsGraph.isLoadingGraph);
  const onRefresh = conflictsGraph.handleRefreshGraph;
  const onReindex = conflictsGraph.handleReindex;
  const onLoadMore = conflictsGraph.handleLoadMoreGraph;
  const onNodeClick = conflictsGraph.handleGraphNodeClick;
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(null);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const paletteRef = useRef<GraphPalette>(
    typeof window === "undefined"
      ? { bg: "#181818", text: "#d4d4d4", node: "#5588cc", link: "#55cc88" }
      : readPalette()
  );

  const isEmpty = !graphData || (graphData.nodes.length === 0 && graphData.links.length === 0);

  // Mount the force-graph instance once the container is available.
  // The container is a dedicated sibling div with no React-managed children — ForceGraph's
  // init() calls `domNode.innerHTML = ''`, which would otherwise yank React-managed nodes
  // out of the DOM and cause NotFoundError on the next removeChild.
  useEffect(() => {
    if (!containerRef.current) return;
    if (isEmpty) return;

    (async () => {
      const ForceGraph = (await import("force-graph")).default as unknown as () => (el: HTMLElement) => any;
      if (!containerRef.current) return;

      const el = containerRef.current;
      const g = ForceGraph()(el)
        .backgroundColor(paletteRef.current.bg)
        .nodeRelSize(5)
        .nodeColor((node: GraphNode) => node.color ?? paletteRef.current.node)
        .nodeLabel((node: GraphNode) => node.label ?? "")
        .linkColor((link: GraphLink) => link.color ?? paletteRef.current.link)
        .linkWidth(2)
        .linkDirectionalParticles(2)
        .linkDirectionalParticleWidth(2)
        .linkDirectionalParticleColor((link: GraphLink) => link.color ?? paletteRef.current.link)
        .nodeCanvasObjectMode(() => "after")
        .nodeCanvasObject((node: GraphNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
          if (node.x == null || node.y == null) return;
          const label = (node.label ?? "").slice(0, 30);
          const fontSize = Math.max(8, 12 / globalScale);
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillStyle = paletteRef.current.text;
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

      g.d3Force("link")?.distance(70);
      g.d3Force("charge")?.strength(-180);
      g.d3VelocityDecay(0.3);
      g.d3ReheatSimulation();

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

  // Refresh palette + canvas background when the active theme changes
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      paletteRef.current = readPalette();
      graphRef.current?.backgroundColor(paletteRef.current.bg);
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  // Resize the canvas when the container dimensions change (e.g. panel drag-resize)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (graphRef.current && el.clientWidth > 0 && el.clientHeight > 0) {
        graphRef.current.width(el.clientWidth).height(el.clientHeight);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleRefresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  return (
    <div className="knowledge-graph-panel">
      <div className="knowledge-graph-header">
        <div className="knowledge-graph-legend">
          <span className="kg-legend-dot kg-legend-dot--node" /> Files
          <span className="kg-legend-dot kg-legend-dot--link" /> Wikilinks
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="header-icon-btn" onClick={onReindex} disabled={isLoading} title="Re-index workspace files"><FolderSync size={13} /></button>
          <button className="header-icon-btn" onClick={handleRefresh} title="Refresh graph"><RotateCw size={13} /></button>
        </div>
      </div>

      <div className="knowledge-graph-body">
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        {isLoading && isEmpty && (
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
          {pagination && pagination.offset + pagination.limit < pagination.totalFiles && onLoadMore && (
            <button
              className="knowledge-graph-btn"
              style={{ marginLeft: 8 }}
              onClick={onLoadMore}
              disabled={isLoading}
              title={`Showing ${pagination.offset + pagination.limit} of ${pagination.totalFiles} files`}
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
