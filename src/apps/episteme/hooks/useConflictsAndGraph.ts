import { useCallback, useEffect, useState } from "react";
import type { ContradictionRecord } from "../components/ConflictsPanel.tsx";
import type { GraphData, GraphLink } from "../components/KnowledgeGraph.tsx";
import type { Subscribe } from "./useWebSocket.ts";

type AgentState = "idle" | "thinking" | "disconnected";

interface GraphPagination {
  offset: number;
  limit: number;
  totalFiles: number;
}

export function useConflictsAndGraph(
  wsRef: React.MutableRefObject<WebSocket | null>,
  agentState: AgentState,
  openFile: (path: string) => void,
  subscribe: Subscribe,
) {
  const [showConflicts, setShowConflicts] = useState(false);
  const [contradictions, setContradictions] = useState<ContradictionRecord[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const [showGraph, setShowGraph] = useState(false);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [graphPagination, setGraphPagination] = useState<GraphPagination | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);

  const handleOpenConflicts = useCallback(() => {
    setShowConflicts(true);
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "contradictions_request" }));
  }, [agentState, wsRef]);

  const handleContradictionScan = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected" || isScanning) return;
    setIsScanning(true);
    wsRef.current.send(JSON.stringify({ type: "contradiction_scan_request" }));
  }, [agentState, isScanning, wsRef]);

  const handleOpenGraph = useCallback(() => {
    setShowGraph(true);
    if (!wsRef.current || agentState === "disconnected") return;
    setIsLoadingGraph(true);
    wsRef.current.send(JSON.stringify({ type: "graph_request" }));
  }, [agentState, wsRef]);

  const handleRefreshGraph = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected") return;
    setIsLoadingGraph(true);
    wsRef.current.send(JSON.stringify({ type: "graph_request" }));
  }, [agentState, wsRef]);

  const handleLoadMoreGraph = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected" || !graphPagination) return;
    const nextOffset = graphPagination.offset + graphPagination.limit;
    if (nextOffset >= graphPagination.totalFiles) return;
    setIsLoadingGraph(true);
    wsRef.current.send(JSON.stringify({
      type: "graph_request",
      offset: nextOffset,
      limit: graphPagination.limit,
    }));
  }, [agentState, wsRef, graphPagination]);

  const handleGraphNodeClick = useCallback((file: string) => {
    openFile(file);
  }, [openFile]);

  useEffect(() => {
    const unsubContradictions = subscribe("contradictions_data", (msg) => {
      setContradictions(msg.contradictions);
      setIsScanning(false);
    });
    const unsubGraph = subscribe("graph_data", (msg) => {
      setGraphPagination(msg.pagination);
      if (msg.pagination.offset === 0) {
        setGraphData(msg.data);
      } else {
        // Append the newly paginated slice, deduplicating by node id and edge identity.
        setGraphData((prev) => {
          if (!prev) return msg.data;
          const ids = new Set(prev.nodes.map((n) => n.id));
          const newNodes = msg.data.nodes.filter((n) => !ids.has(n.id));
          const linkKey = (l: GraphLink) =>
            `${typeof l.source === "string" ? l.source : (l.source as { id: string }).id}>${typeof l.target === "string" ? l.target : (l.target as { id: string }).id}>${l.linkType}`;
          const linkSet = new Set(prev.links.map(linkKey));
          const newLinks = msg.data.links.filter((l) => !linkSet.has(linkKey(l)));
          return { nodes: [...prev.nodes, ...newNodes], links: [...prev.links, ...newLinks] };
        });
      }
      setIsLoadingGraph(false);
    });
    return () => {
      unsubContradictions();
      unsubGraph();
    };
  }, [subscribe]);

  return {
    showConflicts,
    contradictions,
    isScanning,
    showGraph,
    graphData,
    graphPagination,
    isLoadingGraph,
    setShowConflicts,
    setContradictions,
    setIsScanning,
    setShowGraph,
    setGraphData,
    setIsLoadingGraph,
    handleOpenConflicts,
    handleContradictionScan,
    handleOpenGraph,
    handleRefreshGraph,
    handleLoadMoreGraph,
    handleGraphNodeClick,
  };
}
