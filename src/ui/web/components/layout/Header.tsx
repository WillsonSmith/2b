export function Header({
  connected,
  currentModel,
  sidebarOpen,
  conflictCount,
  panelsAvailable,
  onToggleSidebar,
  chatListOpen,
  onToggleChatList,
}: {
  connected: boolean;
  currentModel: string;
  sidebarOpen: boolean;
  conflictCount: number;
  panelsAvailable: boolean;
  onToggleSidebar: () => void;
  chatListOpen: boolean;
  onToggleChatList: () => void;
}) {
  return (
    <header className="header">
      <div className="header-left">
        <button
          className="hamburger-btn"
          onClick={onToggleChatList}
          title={chatListOpen ? "Close conversations" : "Open conversations"}
          aria-label="Toggle conversation list"
        >
          {chatListOpen ? "✕" : "☰"}
        </button>
        <span className="header-title">2b</span>
      </div>
      <div className="header-right">
        <span className="header-model">
          {connected ? currentModel || "connected" : "connecting…"}
        </span>
        {panelsAvailable && (
          <button
            className="sidebar-toggle"
            onClick={onToggleSidebar}
            title={sidebarOpen ? "Close panel" : "Open panel"}
          >
            {sidebarOpen ? "⊠" : "⊞"}
            {!sidebarOpen && conflictCount > 0 && (
              <span className="tab-badge">{conflictCount}</span>
            )}
          </button>
        )}
      </div>
    </header>
  );
}
