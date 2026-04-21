import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../types.ts";
import { generateId } from "../types.ts";
import type { SessionMeta } from "../ChatSessionStore.ts";
import type { UseWebSocketReturn } from "./useWebSocket.ts";

export interface UseChatSessionsReturn {
  sessions: SessionMeta[];
  activeId: string;
  liveMessages: ChatMessage[];
  createSession: () => Promise<void>;
  switchSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  snapshotMessages: (msgs: ChatMessage[]) => void;
  refreshSessions: () => Promise<void>;
}

function idFromPath(path: string): string {
  const match = /^\/chat\/([^/]+)$/.exec(path);
  return match?.[1] ?? "";
}

export function useChatSessions({
  ws,
  path,
  navigate,
}: {
  ws: UseWebSocketReturn;
  path: string;
  navigate: (path: string) => void;
}): UseChatSessionsReturn {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);

  const urlId = idFromPath(path);
  const [activeId, setActiveId] = useState<string>(
    () => urlId || (localStorage.getItem("activeChatSession") ?? ""),
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<(() => void) | null>(null);
  const activeIdRef = useRef(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const setActiveAndNavigate = useCallback(
    (id: string) => {
      setActiveId(id);
      localStorage.setItem("activeChatSession", id);
      navigate(`/chat/${id}`);
    },
    [navigate],
  );

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      if (res.ok) setSessions((await res.json()) as SessionMeta[]);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // Ensure an active session exists on first load
  useEffect(() => {
    if (activeId) return;
    const id = generateId();
    fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
      .then((res) => {
        if (!res.ok) return;
        setActiveAndNavigate(id);
        refreshSessions();
      })
      .catch(() => {});
  }, [activeId, refreshSessions, setActiveAndNavigate]);

  // On initial mount, restore stored messages for the active session
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !activeId) return;
    restoredRef.current = true;
    fetch(`/api/sessions/${activeId}/messages`)
      .then(async (res) => {
        if (!res.ok) return;
        const msgs = (await res.json()) as ChatMessage[];
        if (msgs.length > 0) ws.setMessages(msgs);
      })
      .catch(() => {});
  }, [activeId, ws.setMessages]);

  const flushSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (pendingSaveRef.current) {
      pendingSaveRef.current();
      pendingSaveRef.current = null;
    }
  }, []);

  const snapshotMessages = useCallback((msgs: ChatMessage[]) => {
    const id = activeIdRef.current;
    if (!id) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const save = () => {
      pendingSaveRef.current = null;
      fetch(`/api/sessions/${id}/messages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
      }).catch(() => {});
    };
    pendingSaveRef.current = save;
    debounceRef.current = setTimeout(save, 500);
  }, []);

  const createSession = useCallback(async () => {
    const id = generateId();
    await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    ws.send({ type: "clear" });
    ws.setMessages([]);
    setActiveAndNavigate(id);
    await refreshSessions();
  }, [ws.send, ws.setMessages, setActiveAndNavigate, refreshSessions]);

  const switchSession = useCallback(
    async (id: string) => {
      flushSave();
      ws.send({ type: "clear" });
      const res = await fetch(`/api/sessions/${id}/messages`);
      const msgs = res.ok ? ((await res.json()) as ChatMessage[]) : [];
      ws.setMessages(msgs);
      setActiveAndNavigate(id);
    },
    [ws.send, ws.setMessages, flushSave, setActiveAndNavigate],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await fetch(`/api/sessions/${id}`, { method: "DELETE" });

      if (id !== activeId) {
        await refreshSessions();
        return;
      }

      // Deleting the active session — switch to another if one exists
      const others = sessions
        .filter((s) => s.id !== id)
        .sort((a, b) => b.updatedAt - a.updatedAt);

      if (others.length > 0) {
        await switchSession(others[0]!.id);
        await refreshSessions();
      } else {
        await createSession();
      }
    },
    [activeId, sessions, createSession, switchSession, refreshSessions],
  );

  return {
    sessions,
    activeId,
    liveMessages: ws.messages,
    createSession,
    switchSession,
    deleteSession,
    snapshotMessages,
    refreshSessions,
  };
}
