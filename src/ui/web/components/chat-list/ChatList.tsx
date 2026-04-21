import type { SessionMeta } from "../../ChatSessionStore.ts";
import { ChatListItem } from "./ChatListItem.tsx";

export function ChatList({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onDelete,
}: {
  sessions: SessionMeta[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
}) {
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="chat-list">
      <div className="chat-list-header">
        <button className="chat-list-new" onClick={onCreate}>
          + New Chat
        </button>
      </div>
      <div className="chat-list-sessions">
        {sorted.map((s) => (
          <ChatListItem
            key={s.id}
            session={s}
            isActive={s.id === activeId}
            onSelect={() => onSelect(s.id)}
            onDelete={() => onDelete(s.id)}
          />
        ))}
        {sorted.length === 0 && (
          <div className="chat-list-empty">No conversations yet.</div>
        )}
      </div>
    </div>
  );
}
