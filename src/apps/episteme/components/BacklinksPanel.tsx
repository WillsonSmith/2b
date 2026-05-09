import { RotateCw, X } from "lucide-react";
import type { BacklinkItem } from "../features/wikilinks.ts";

interface BacklinksPanelProps {
  path: string | null;
  items: BacklinkItem[];
  isLoading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
}

export function BacklinksPanel({
  path,
  items,
  isLoading,
  onClose,
  onRefresh,
  onNavigate,
}: BacklinksPanelProps) {
  const title = path ? path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path : "Backlinks";

  return (
    <div className="backlinks-panel">
      <div className="backlinks-panel-header">
        <span className="backlinks-panel-title">
          Backlinks
          {path && <span className="backlinks-panel-target"> → {title}</span>}
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            className="conflicts-refresh-btn"
            onClick={onRefresh}
            title="Refresh backlinks"
            disabled={isLoading}
          >
            <RotateCw size={13} />
          </button>
          <button className="conflicts-panel-close" onClick={onClose} title="Close">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="backlinks-content">
        {isLoading ? (
          <div className="backlinks-empty">Scanning backlinks…</div>
        ) : !path ? (
          <div className="backlinks-empty">Open a file to see its backlinks.</div>
        ) : items.length === 0 ? (
          <div className="backlinks-empty">
            No files link to <strong>{title}</strong>.
          </div>
        ) : (
          items.map((item, i) => {
            const sourceName = item.sourcePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? item.sourcePath;
            return (
              <div
                key={i}
                className="backlinks-item"
                onClick={() => onNavigate(item.sourcePath)}
                title={item.sourcePath}
              >
                <div className="backlinks-item-file">{sourceName}</div>
                <div className="backlinks-item-snippet">{item.snippet}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
