import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentState, Subscribe } from "./useWebSocket.ts";

const SEND_DEBOUNCE_MS = 200;

export function useFileTreeState(
  wsRef: React.MutableRefObject<WebSocket | null>,
  agentState: AgentState,
  subscribe: Subscribe,
  workspaceRoot: string,
) {
  const [expandedDirs, setExpandedDirsState] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const migratedRef = useRef(false);
  const pendingSendRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ask the server for stored expansion state once we're connected.
  useEffect(() => {
    if (agentState === "disconnected" || !wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: "get_filetree_expanded" }));
  }, [agentState, wsRef]);

  useEffect(() => {
    const unsub = subscribe("filetree_expanded", (msg) => {
      setExpandedDirsState(msg.paths);
      setLoaded(true);
    });
    return unsub;
  }, [subscribe]);

  // One-time migration of any leftover localStorage value into the DB.
  useEffect(() => {
    if (!loaded || migratedRef.current || !workspaceRoot) return;
    if (expandedDirs.length > 0) {
      migratedRef.current = true;
      return;
    }
    try {
      const key = `episteme:filetree:expanded:${workspaceRoot}`;
      const stored = localStorage.getItem(key);
      if (!stored) {
        migratedRef.current = true;
        return;
      }
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const paths = parsed.filter((p): p is string => typeof p === "string");
        setExpandedDirsState(paths);
        wsRef.current?.send(JSON.stringify({ type: "set_filetree_expanded", paths }));
      }
      localStorage.removeItem(key);
    } catch {
      // ignore malformed value
    }
    migratedRef.current = true;
  }, [loaded, workspaceRoot, expandedDirs.length, wsRef]);

  const setExpandedDirs = useCallback((paths: string[]) => {
    setExpandedDirsState(paths);
    if (pendingSendRef.current) clearTimeout(pendingSendRef.current);
    pendingSendRef.current = setTimeout(() => {
      pendingSendRef.current = null;
      wsRef.current?.send(JSON.stringify({ type: "set_filetree_expanded", paths }));
    }, SEND_DEBOUNCE_MS);
  }, [wsRef]);

  useEffect(() => () => {
    if (pendingSendRef.current) clearTimeout(pendingSendRef.current);
  }, []);

  return { expandedDirs, setExpandedDirs };
}
