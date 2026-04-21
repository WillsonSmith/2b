import type React from "react";

export function AppShell({
  children,
  sidebar,
  chatList,
  chatListOpen = false,
}: {
  children: React.ReactNode;
  sidebar?: React.ReactNode;
  chatList?: React.ReactNode;
  chatListOpen?: boolean;
}) {
  const classes = [
    "app-shell",
    sidebar ? "app-shell--sidebar-open" : "",
    chatListOpen ? "app-shell--chatlist-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      {chatList}
      <div className="app">{children}</div>
      {sidebar}
    </div>
  );
}
