import { ContextMenu } from "../../composites/ContextMenu.tsx";
import type { MenuEntry } from "../../composites/Menu.tsx";
import { basename } from "./pathUtils.ts";

export type FileTreeContextTarget =
  | { type: "background" }
  | { type: "dir"; path: string }
  | { type: "file"; path: string };

interface FileTreeContextMenuProps {
  target: FileTreeContextTarget | null;
  x: number;
  y: number;
  workspaceRoot: string;
  onClose: () => void;
  onNewFileRoot: () => void;
  onNewFolderRoot: () => void;
  onNewFileInDir: (path: string) => void;
  onNewFolderInDir: (path: string) => void;
  onRenameFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onOpenInFinder: (path: string) => void;
  onCopy: (text: string) => void;
}

function buildItems(props: FileTreeContextMenuProps): ReadonlyArray<MenuEntry> {
  const { target, workspaceRoot } = props;
  if (!target) return [];

  if (target.type === "background") {
    return [
      { id: "new-file", label: "New file", onSelect: props.onNewFileRoot },
      { id: "new-folder", label: "New folder", onSelect: props.onNewFolderRoot },
    ];
  }

  if (target.type === "dir") {
    const items: MenuEntry[] = [
      { id: "new-file", label: "New file here", onSelect: () => props.onNewFileInDir(target.path) },
      { id: "new-folder", label: "New folder here", onSelect: () => props.onNewFolderInDir(target.path) },
      { id: "sep-1", divider: true },
      { id: "copy-name", label: "Copy name", onSelect: () => props.onCopy(basename(target.path)) },
      { id: "copy-path", label: "Copy path", onSelect: () => props.onCopy(target.path) },
    ];
    if (workspaceRoot) {
      items.push({
        id: "copy-abs",
        label: "Copy absolute path",
        onSelect: () => props.onCopy(`${workspaceRoot}/${target.path}`),
      });
    }
    items.push(
      { id: "sep-2", divider: true },
      { id: "finder", label: "Open in Finder", onSelect: () => props.onOpenInFinder(target.path) },
    );
    return items;
  }

  // file
  const items: MenuEntry[] = [
    { id: "rename", label: "Rename", onSelect: () => props.onRenameFile(target.path) },
    { id: "sep-1", divider: true },
    { id: "delete", label: "Delete", danger: true, onSelect: () => props.onDeleteFile(target.path) },
    { id: "sep-2", divider: true },
    { id: "copy-name", label: "Copy name", onSelect: () => props.onCopy(basename(target.path)) },
    { id: "copy-path", label: "Copy path", onSelect: () => props.onCopy(target.path) },
  ];
  if (workspaceRoot) {
    items.push({
      id: "copy-abs",
      label: "Copy absolute path",
      onSelect: () => props.onCopy(`${workspaceRoot}/${target.path}`),
    });
  }
  items.push(
    { id: "sep-3", divider: true },
    { id: "finder", label: "Open in Finder", onSelect: () => props.onOpenInFinder(target.path) },
  );
  return items;
}

export function FileTreeContextMenu(props: FileTreeContextMenuProps) {
  const { target, x, y, onClose } = props;
  return (
    <ContextMenu
      open={target !== null}
      onClose={onClose}
      x={x}
      y={y}
      items={buildItems(props)}
    />
  );
}
