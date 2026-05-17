import { useCallback, useEffect, useState } from "react";
import type { BacklinkItem } from "../features/links.ts";
import type { Subscribe } from "./useWebSocket.ts";

type AgentState = "idle" | "thinking" | "disconnected";

export function useBacklinks(
  wsRef: React.MutableRefObject<WebSocket | null>,
  agentState: AgentState,
  subscribe: Subscribe,
) {
  const [showBacklinks, setShowBacklinks] = useState(false);
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [isLoadingBacklinks, setIsLoadingBacklinks] = useState(false);
  const [backlinksPath, setBacklinksPath] = useState<string | null>(null);

  useEffect(() => {
    return subscribe("backlinks_result", (msg) => {
      setBacklinksPath(msg.path);
      setBacklinks(msg.items);
      setIsLoadingBacklinks(false);
    });
  }, [subscribe]);

  const fetchBacklinks = useCallback((path: string) => {
    if (!wsRef.current || agentState === "disconnected") return;
    setIsLoadingBacklinks(true);
    setBacklinksPath(path);
    wsRef.current.send(JSON.stringify({ type: "backlinks_request", path }));
  }, [agentState, wsRef]);

  const handleOpenBacklinks = useCallback((path: string | null) => {
    if (!path) return;
    setShowBacklinks(true);
    fetchBacklinks(path);
  }, [fetchBacklinks]);

  const handleRefreshBacklinks = useCallback((path: string | null) => {
    if (!path) return;
    fetchBacklinks(path);
  }, [fetchBacklinks]);

  return {
    showBacklinks,
    setShowBacklinks,
    backlinks,
    setBacklinks,
    isLoadingBacklinks,
    setIsLoadingBacklinks,
    backlinksPath,
    handleOpenBacklinks,
    handleRefreshBacklinks,
  };
}
