import { useCallback, useEffect, useState } from "react";
import type { UnifiedSearchResponse } from "../components/ResearchPanel.tsx";
import type { Subscribe } from "./useWebSocket.ts";

type AgentState = "idle" | "thinking" | "disconnected";

export function useResearch(
  wsRef: React.MutableRefObject<WebSocket | null>,
  agentState: AgentState,
  subscribe: Subscribe,
) {
  const [showResearch, setShowResearch] = useState(false);
  const [searchResults, setSearchResults] = useState<UnifiedSearchResponse | null>(null);
  const [gapReport, setGapReport] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isDetectingGaps, setIsDetectingGaps] = useState(false);

  const handleSearch = useCallback((query: string) => {
    if (!wsRef.current || agentState === "disconnected") return;
    setIsSearching(true);
    setSearchResults(null);
    wsRef.current.send(JSON.stringify({ type: "search_request", query }));
  }, [agentState, wsRef]);

  const handleDetectGaps = useCallback((topic: string) => {
    if (!wsRef.current || agentState === "disconnected") return;
    setIsDetectingGaps(true);
    setGapReport(null);
    wsRef.current.send(JSON.stringify({ type: "detect_gaps_request", topic }));
  }, [agentState, wsRef]);

  const handleIngestFromSearch = useCallback((url: string) => {
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "ingest_url", url }));
  }, [agentState, wsRef]);

  const handleReindex = useCallback(() => {
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "send", text: "Please run the index_workspace tool to re-index all workspace files." }));
  }, [agentState, wsRef]);

  useEffect(() => {
    const unsubSearch = subscribe("search_result", (msg) => {
      setSearchResults(msg.results);
      setIsSearching(false);
    });
    const unsubGaps = subscribe("detect_gaps_result", (msg) => {
      setGapReport(msg.markdown);
      setIsDetectingGaps(false);
    });
    return () => {
      unsubSearch();
      unsubGaps();
    };
  }, [subscribe]);

  return {
    showResearch,
    searchResults,
    gapReport,
    isSearching,
    isDetectingGaps,
    setShowResearch,
    setSearchResults,
    setGapReport,
    setIsSearching,
    setIsDetectingGaps,
    handleSearch,
    handleDetectGaps,
    handleIngestFromSearch,
    handleReindex,
  };
}
