import type React from "react";
import { useCallback } from "react";
import type { SessionMeta } from "../../ChatSessionStore.ts";

export function ChatListItem({
  session,
  isActive,
  onSelect,
  onDelete,
}: {
  session: SessionMeta;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirm(`Delete "${session.title}"?`)) onDelete();
    },
    [session.title, onDelete],
  );

  const date = new Date(session.updatedAt);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const formatted = isToday
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div
      className={`chat-list-item ${isActive ? "chat-list-item--active" : ""}`}
      onClick={onSelect}
    >
      <div className="chat-list-item-title">{session.title}</div>
      <div className="chat-list-item-meta">
        <span className="chat-list-item-date">{formatted}</span>
        <button
          className="chat-list-item-delete"
          onClick={handleDelete}
          title="Delete conversation"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
