import type { DragEvent, MouseEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Icon } from "../../primitives/Icon.tsx";
import { IndentGuides } from "./IndentGuides.tsx";

interface DirRowProps {
  path: string;
  label: string;
  depth: number;
  collapsed: boolean;
  dragOver: boolean;
  dragging: boolean;
  onToggle: () => void;
  onContextMenu: (e: MouseEvent<HTMLDivElement>) => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}

export function DirRow({
  path,
  label,
  depth,
  collapsed,
  dragOver,
  dragging,
  onToggle,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: DirRowProps) {
  const classes = [
    "file-tree-dir-row",
    dragOver && "drag-over",
    dragging && "dragging",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      draggable
      onClick={onToggle}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      title={path}
    >
      <IndentGuides depth={depth} />
      <span className="file-tree-dir-chevron">
        <Icon icon={collapsed ? ChevronRight : ChevronDown} size="xs" />
      </span>
      <span>{label}</span>
    </div>
  );
}
