import { useCallback, useEffect, useRef, useState } from "react";
import { assertNever, type ServerMsg } from "../protocol.ts";

type AgentState = "idle" | "thinking" | "disconnected";

export type ServerMsgType = ServerMsg["type"];
export type ServerMsgOf<T extends ServerMsgType> = Extract<ServerMsg, { type: T }>;
export type Subscriber<T extends ServerMsgType> = (msg: ServerMsgOf<T>) => void;
export type Subscribe = <T extends ServerMsgType>(
  type: T,
  handler: Subscriber<T>,
) => () => void;

export interface UseWebSocketReturn {
  wsRef: React.MutableRefObject<WebSocket | null>;
  agentState: AgentState;
  sendToAgent: (text: string) => void;
  interrupt: () => void;
  subscribe: Subscribe;
}

/**
 * Connects the WebSocket and exposes a typed `subscribe(type, handler)` API.
 * Consumers register listeners only for the messages they care about; the
 * exhaustiveness check in `dispatch` fails to compile when a new ServerMsg
 * type is added without being routed.
 */
export function useWebSocket(): UseWebSocketReturn {
  const [agentState, setAgentState] = useState<AgentState>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Map<ServerMsgType, Set<Subscriber<ServerMsgType>>>>(new Map());

  const subscribe = useCallback<Subscribe>((type, handler) => {
    const map = subscribersRef.current;
    let set = map.get(type);
    if (!set) {
      set = new Set();
      map.set(type, set);
    }
    const erased = handler as unknown as Subscriber<ServerMsgType>;
    set.add(erased);
    return () => {
      const s = subscribersRef.current.get(type);
      if (!s) return;
      s.delete(erased);
      if (s.size === 0) subscribersRef.current.delete(type);
    };
  }, []);

  function dispatch(msg: ServerMsg): void {
    switch (msg.type) {
      case "state_change":
        setAgentState(msg.state);
        break;
      case "speak":
      case "tool_call":
      case "tool_result":
      case "file_content":
      case "workspace_files":
      case "index_progress":
      case "file_saved":
      case "file_created":
      case "file_renamed":
      case "autocomplete_suggestion":
      case "insert_text":
      case "ingest_result":
      case "tone_result":
      case "summarize_result":
      case "lint_result":
      case "metadata_result":
      case "toc_result":
      case "autolink_result":
      case "diagram_result":
      case "table_result":
      case "search_result":
      case "detect_gaps_result":
      case "contradictions_data":
      case "graph_data":
      case "check_citations_result":
      case "format_citation_result":
      case "alt_text":
      case "explain_code_result":
      case "transcript":
      case "error":
        break;
      default:
        assertNever(msg);
    }
    const subs = subscribersRef.current.get(msg.type);
    if (!subs) return;
    for (const handler of subs) {
      handler(msg);
    }
  }

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(`ws://${location.host}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setAgentState("idle");
        ws.send(JSON.stringify({ type: "list_workspace" }));
      };

      ws.onclose = () => {
        setAgentState("disconnected");
        wsRef.current = null;
        setTimeout(connect, 2000);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMsg;
        dispatch(msg);
      };
    }

    connect();
    return () => wsRef.current?.close();
  }, []);

  const sendToAgent = useCallback((text: string) => {
    if (!wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(JSON.stringify({ type: "send", text }));
  }, [agentState]);

  const interrupt = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "interrupt" }));
  }, []);

  return { wsRef, agentState, sendToAgent, interrupt, subscribe };
}
