import type { DragEvent, MouseEvent } from "react";
import { FileText } from "lucide-react";
import { Icon } from "../../primitives/Icon.tsx";
import { IndentGuides } from "./IndentGuides.tsx";

interface FileRowProps {
  path: string;
  label: string;
  depth: number;
  active: boolean;
  dragging: boolean;
  onOpen: () => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

export function FileRow({
  path,
  label,
  depth,
  active,
  dragging,
  onOpen,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: FileRowProps) {
  const classes = [
    "file-tree-item",
    active && "active",
    dragging && "dragging",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      data-path={path}
      className={classes}
      draggable
      onClick={onOpen}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title={path}
      style={{ paddingLeft: 6 }}
    >
      <IndentGuides depth={depth} />
      <span className="file-tree-item-icon"><Icon icon={FileText} size="xs" /></span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </div>
  );
}
