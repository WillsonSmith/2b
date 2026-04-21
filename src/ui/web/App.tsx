import { useCallback, useEffect, useRef, useState } from "react";
import type { ConflictRecord } from "./types.ts";
import { useWebSocket } from "./hooks/useWebSocket.ts";
import { useSlashCommands } from "./hooks/useSlashCommands.ts";
import { useChatSessions } from "./hooks/useChatSessions.ts";
import { useRouter } from "./hooks/useRouter.ts";
import { AppShell } from "./components/layout/AppShell.tsx";
import { Header } from "./components/layout/Header.tsx";
import { MessageList } from "./components/chat/MessageList.tsx";
import { StatusArea } from "./components/chat/StatusArea.tsx";
import { StopButton } from "./components/chat/StopButton.tsx";
import { ChatInput } from "./components/chat/ChatInput.tsx";
import { ChatList } from "./components/chat-list/ChatList.tsx";
import { Sidebar } from "./components/sidebar/Sidebar.tsx";
import { PermissionDialog } from "./components/overlays/PermissionDialog.tsx";

export function App() {
  const ws = useWebSocket();
  const { path, navigate } = useRouter();
  const sessions = useChatSessions({ ws, path, navigate });

  const [showReasoning, setShowReasoning] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem("sidebarOpen") === "true",
  );
  const [chatListOpen, setChatListOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem("sidebarOpen", sidebarOpen ? "true" : "false");
  }, [sidebarOpen]);

  // Autosave messages to the active session whenever they change
  useEffect(() => {
    if (ws.messages.length === 0) return;
    sessions.snapshotMessages(ws.messages);
  }, [ws.messages]);

  // Auto-title: when the first assistant message completes and title is still "New Chat"
  const autoTitledRef = useRef<string>("");
  useEffect(() => {
    if (!sessions.activeId) return;
    if (autoTitledRef.current === sessions.activeId) return;
    const currentSession = sessions.sessions.find(
      (s) => s.id === sessions.activeId,
    );
    if (!currentSession || currentSession.title !== "New Chat") return;
    const firstComplete = ws.messages.find(
      (m) => m.role === "assistant" && m.status === "complete" && m.content.length > 0,
    );
    if (!firstComplete) return;
    const firstUser = ws.messages.find((m) => m.role === "user");
    if (!firstUser) return;
    const title = firstUser.content.slice(0, 60).trim();
    autoTitledRef.current = sessions.activeId;
    fetch(`/api/sessions/${sessions.activeId}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
      .then(() => sessions.refreshSessions())
      .catch(() => {});
  }, [ws.messages, sessions.activeId, sessions.sessions]);

  const handleSlash = useSlashCommands({
    messages: ws.messages,
    currentModel: ws.currentModel,
    systemPrompt: ws.systemPrompt,
    send: ws.send,
    setMessages: ws.setMessages,
    setCurrentModel: ws.setCurrentModel,
    setShowReasoning,
  });

  const handleSubmit = useCallback(
    (text: string) => {
      if (!handleSlash(text)) ws.send({ type: "send", text });
    },
    [handleSlash, ws.send],
  );

  const handlePermission = useCallback(
    (response: "yes" | "always" | "no") => {
      ws.setPendingPermission(null);
      ws.send({ type: "permission_response", response });
    },
    [ws.setPendingPermission, ws.send],
  );

  const handleDismissConflict = useCallback(
    async (c: ConflictRecord) => {
      const key = [c.newId, c.conflictId].sort().join("::");
      await fetch(`/api/behaviors/conflicts/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      ws.setConflicts((prev) =>
        prev.filter(
          (x) => !(x.newId === c.newId && x.conflictId === c.conflictId),
        ),
      );
    },
    [ws.setConflicts],
  );

  const handleSynthesize = useCallback(
    async (c: ConflictRecord) => {
      ws.setConflicts((prev) =>
        prev.filter(
          (x) => !(x.newId === c.newId && x.conflictId === c.conflictId),
        ),
      );
    },
    [ws.setConflicts],
  );

  const isBlocked = ws.state === "thinking" || !!ws.pendingPermission;
  const showSidebar = sidebarOpen && ws.availablePanels.length > 0;

  return (
    <AppShell
      chatList={
        <ChatList
          sessions={sessions.sessions}
          activeId={sessions.activeId}
          onSelect={(id) => {
            sessions.switchSession(id);
            setChatListOpen(false);
          }}
          onCreate={() => {
            sessions.createSession();
            setChatListOpen(false);
          }}
          onDelete={sessions.deleteSession}
        />
      }
      chatListOpen={chatListOpen}
      sidebar={
        showSidebar ? (
          <Sidebar
            panels={ws.availablePanels}
            conflicts={ws.conflicts}
            coreBehaviors={ws.coreBehaviors}
            contextualBehaviors={ws.contextualBehaviors}
            dynamicAgents={ws.dynamicAgents}
            onDismissConflict={handleDismissConflict}
            onSynthesize={handleSynthesize}
          />
        ) : undefined
      }
    >
      <Header
        connected={ws.connected}
        currentModel={ws.currentModel}
        sidebarOpen={sidebarOpen}
        conflictCount={ws.conflicts.length}
        panelsAvailable={ws.availablePanels.length > 0}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        chatListOpen={chatListOpen}
        onToggleChatList={() => setChatListOpen((v) => !v)}
      />
      <MessageList
        messages={sessions.liveMessages}
        showReasoning={showReasoning}
        messagesEndRef={ws.messagesEndRef}
      />
      <StatusArea
        state={ws.state}
        activeTools={ws.activeTools}
        dynamicAgents={ws.dynamicAgents}
      />
      {ws.state === "thinking" && (
        <StopButton
          onStop={() => ws.send({ type: "interrupt", scope: "all" })}
        />
      )}
      <ChatInput
        isBlocked={isBlocked}
        agentState={ws.state}
        onSubmit={handleSubmit}
      />
      {ws.pendingPermission && (
        <PermissionDialog
          request={ws.pendingPermission}
          onRespond={handlePermission}
        />
      )}
    </AppShell>
  );
}
