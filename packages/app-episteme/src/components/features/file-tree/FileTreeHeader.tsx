import { Plus, RotateCw } from "lucide-react";
import { Icon } from "../../primitives/Icon.tsx";
import { IconButton } from "../../primitives/IconButton.tsx";

interface FileTreeHeaderProps {
  onNewFile: () => void;
  onRefresh: () => void;
}

export function FileTreeHeader({ onNewFile, onRefresh }: FileTreeHeaderProps) {
  return (
    <div className="file-tree-tabs">
      <span className="file-tree-tab active">Files</span>
      <IconButton
        size="sm"
        icon={<Icon icon={Plus} size="sm" />}
        aria-label="New file"
        onClick={onNewFile}
        className="header-icon-btn"
      />
      <IconButton
        size="sm"
        icon={<Icon icon={RotateCw} size="xs" />}
        aria-label="Refresh file list"
        onClick={onRefresh}
        className="header-icon-btn"
      />
    </div>
  );
}
