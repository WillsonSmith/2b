import { useCallback, useEffect, useState } from "react";
import type { ContradictionRecord } from "../components/ConflictsPanel.tsx";
import type { GraphData } from "../components/KnowledgeGraph.tsx";
import type { Subscribe } from "./useWebSocket.ts";

type AgentState = "idle" | "thinking" | "disconnected";

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

  const handleGraphNodeClick = useCallback((file: string) => {
    openFile(file);
  }, [openFile]);

  useEffect(() => {
    const unsubContradictions = subscribe("contradictions_data", (msg) => {
      setContradictions(msg.contradictions);
      setIsScanning(false);
    });
    const unsubGraph = subscribe("graph_data", (msg) => {
      setGraphData(msg.data);
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
    handleGraphNodeClick,
  };
}
