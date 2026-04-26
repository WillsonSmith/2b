import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ActiveTool,
  AgentState,
  BehaviorRecord,
  ChatMessage,
  ConflictRecord,
  ContextualBehaviorRecord,
  DynamicAgentRecord,
  PanelId,
  PermissionRequest,
  WsMessage,
  YieldRequest,
} from "../types.ts";

export interface UseWebSocketReturn {
  connected: boolean;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  state: AgentState;
  activeTools: ActiveTool[];
  dynamicAgents: DynamicAgentRecord[];
  pendingPermission: PermissionRequest | null;
  setPendingPermission: React.Dispatch<
    React.SetStateAction<PermissionRequest | null>
  >;
  pendingYield: YieldRequest | null;
  setPendingYield: React.Dispatch<React.SetStateAction<YieldRequest | null>>;
  currentModel: string;
  setCurrentModel: React.Dispatch<React.SetStateAction<string>>;
  systemPrompt: string;
  coreBehaviors: BehaviorRecord[];
  contextualBehaviors: ContextualBehaviorRecord[];
  conflicts: ConflictRecord[];
  setConflicts: React.Dispatch<React.SetStateAction<ConflictRecord[]>>;
  availablePanels: PanelId[];
  send: (msg: unknown) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export function useWebSocket(): UseWebSocketReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<AgentState>("idle");
  const [activeTools, setActiveTools] = useState<ActiveTool[]>([]);
  const [dynamicAgents, setDynamicAgents] = useState<DynamicAgentRecord[]>([]);
  const [pendingPermission, setPendingPermission] =
    useState<PermissionRequest | null>(null);
  const [pendingYield, setPendingYield] = useState<YieldRequest | null>(null);
  const [currentModel, setCurrentModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [connected, setConnected] = useState(false);
  const [availablePanels, setAvailablePanels] = useState<PanelId[]>([]);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [coreBehaviors, setCoreBehaviors] = useState<BehaviorRecord[]>([]);
  const [contextualBehaviors, setContextualBehaviors] = useState<
    ContextualBehaviorRecord[]
  >([]);

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const upsertMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx === -1) return [...prev, msg];
      const next = [...prev];
      next[idx] = msg;
      return next;
    });
  }, []);

  const fetchCapabilities = useCallback(async () => {
    try {
      const res = await fetch("/api/capabilities");
      const data = (await res.json()) as { panels: PanelId[] };
      setAvailablePanels(data.panels);
    } catch {
      // non-critical
    }
  }, []);

  const fetchConflicts = useCallback(async () => {
    try {
      const res = await fetch("/api/behaviors/conflicts");
      if (res.ok) {
        const data = (await res.json()) as ConflictRecord[];
        setConflicts(data);
      }
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onclose = () => setConnected(false);

    ws.onmessage = (ev) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(ev.data as string) as WsMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "snapshot":
          setMessages((prev) =>
            msg.messages.length > 0 ? (msg.messages as ChatMessage[]) : prev,
          );
          setState(msg.state);
          setActiveTools(msg.activeTools);
          setDynamicAgents(msg.dynamicAgents);
          break;
        case "message":
          upsertMessage(msg.message);
          break;
        case "message_updated":
          upsertMessage(msg.message);
          break;
        case "state_change":
          setState(msg.state);
          break;
        case "active_tools_changed":
          setActiveTools(msg.tools);
          break;
        case "dynamic_agents_changed":
          setDynamicAgents(msg.agents);
          break;
        case "permission_request":
          setPendingPermission(msg.request);
          break;
        case "agent_yield":
          setPendingYield({ reason: msg.reason, partialResult: msg.partialResult });
          break;
        case "model_changed":
          setCurrentModel(msg.model);
          break;
        case "system_prompt":
          setSystemPrompt(msg.systemPrompt);
          setCurrentModel(msg.model);
          break;
        case "behavior_conflict":
          setConflicts((prev) => {
            const key = [msg.newId, msg.conflictId].sort().join("::");
            const exists = prev.some(
              (c) => [c.newId, c.conflictId].sort().join("::") === key,
            );
            if (exists) return prev;
            return [
              ...prev,
              {
                newId: msg.newId,
                newText: msg.newText,
                conflictId: msg.conflictId,
                conflictText: msg.conflictText,
                score: msg.score,
                timestamp: Date.now(),
              },
            ];
          });
          break;
        case "behaviors_loaded":
          setCoreBehaviors(msg.core);
          setContextualBehaviors(msg.contextual);
          break;
      }
    };

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "system_prompt_request" }));
      fetchCapabilities();
      fetchConflicts();
    };

    return () => ws.close();
  }, [upsertMessage, fetchCapabilities, fetchConflicts]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const send = useCallback((msg: unknown) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  return {
    connected,
    messages,
    setMessages,
    state,
    activeTools,
    dynamicAgents,
    pendingPermission,
    setPendingPermission,
    pendingYield,
    setPendingYield,
    currentModel,
    setCurrentModel,
    systemPrompt,
    coreBehaviors,
    contextualBehaviors,
    conflicts,
    setConflicts,
    availablePanels,
    send,
    messagesEndRef,
  };
}
