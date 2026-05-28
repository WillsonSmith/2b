import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent } from "react";
import { ResizeHandle } from "../../composites/ResizeHandle.tsx";
import { usePanelResize } from "../../../hooks/usePanelResize.ts";
import { useFiles } from "../../../state/FileContext.tsx";
import { useUI } from "../../../state/UIContext.tsx";
import { useSignalValue } from "../../../state/signals.ts";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog.tsx";
import { DirRow } from "./DirRow.tsx";
import { FileRow } from "./FileRow.tsx";
import { FileTreeContextMenu } from "./FileTreeContextMenu.tsx";
import type { FileTreeContextTarget } from "./FileTreeContextMenu.tsx";
import { FileTreeHeader } from "./FileTreeHeader.tsx";
import { NewItemInput } from "./NewItemInput.tsx";
import { RenameInput } from "./RenameInput.tsx";
import { basename, dirname } from "./pathUtils.ts";
import { buildItems } from "./treeBuilder.ts";

interface ContextMenuState {
  target: FileTreeContextTarget;
  x: number;
  y: number;
}

export const FileTree = memo(function FileTree() {
  const file = useFiles();
  const ui = useUI();
  const files = useSignalValue(file.workspaceFiles);
  const folders = useSignalValue(file.workspaceFolders);
  const activeFile = useSignalValue(file.activeFile);
  const workspaceRoot = useSignalValue(file.workspaceRoot);
  const initialExpandedDirs = useSignalValue(file.expandedDirs);
  const collapsed = useSignalValue(ui.fileTreeCollapsed);
  const { width, handleMouseDown, isDragging } = usePanelResize(220, "file-tree", { direction: "right" });

  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const [creatingInDir, setCreatingInDir] = useState<string | null>(null);
  const [newFileInDirName, setNewFileInDirName] = useState("");

  const [creatingFolderInDir, setCreatingFolderInDir] = useState<string | null>(null);
  const [newFolderInDirName, setNewFolderInDirName] = useState("");

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const fileListRef = useRef<HTMLDivElement>(null);

  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(initialExpandedDirs));

  const lastInitialRef = useRef<ReadonlyArray<string> | null>(null);
  useEffect(() => {
    if (lastInitialRef.current === initialExpandedDirs) return;
    lastInitialRef.current = initialExpandedDirs;
    setExpandedDirs(new Set(initialExpandedDirs));
  }, [initialExpandedDirs]);

  function toggleDir(dir: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      file.setExpandedDirs([...next]);
      return next;
    });
  }

  function expandDir(dir: string) {
    setExpandedDirs((prev) => {
      if (prev.has(dir)) return prev;
      const next = new Set(prev);
      next.add(dir);
      file.setExpandedDirs([...next]);
      return next;
    });
  }

  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);

  function handleDrop(e: DragEvent, targetDir: string) {
    const kind = e.dataTransfer.getData("text/x-episteme-kind");
    const path = e.dataTransfer.getData("text/plain");
    if (!path) return;

    if (kind === "folder") {
      if (path === targetDir) return;
      if (targetDir.startsWith(path + "/")) return;
      if (dirname(path) === targetDir) return;
      const newPath = targetDir ? `${targetDir}/${basename(path)}` : basename(path);
      file.renameFolder(path, newPath);
    } else {
      if (dirname(path) === targetDir) return;
      const newPath = targetDir ? `${targetDir}/${basename(path)}` : basename(path);
      file.renameFile(path, newPath);
      expandDir(targetDir);
    }

    setDraggingPath(null);
    setDragOverDir(null);
  }

  const items = useMemo(
    () => buildItems(files, folders, expandedDirs, creatingInDir, creatingFolderInDir),
    [files, folders, expandedDirs, creatingInDir, creatingFolderInDir],
  );

  useEffect(() => {
    if (!pendingDelete) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingDelete(null);
      if (e.key === "Enter") {
        file.deleteFile(pendingDelete);
        setPendingDelete(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pendingDelete, file]);

  useEffect(() => {
    if (!activeFile || !fileListRef.current) return;
    const row = fileListRef.current.querySelector(`[data-path="${CSS.escape(activeFile)}"]`);
    if (row instanceof HTMLElement) row.scrollIntoView({ block: "nearest" });
  }, [activeFile, items]);

  function commitCreate() {
    const name = newFileName.trim();
    if (name) file.createFile(name.endsWith(".md") ? name : `${name}.md`);
    setIsCreating(false);
    setNewFileName("");
  }

  function commitCreateFolder() {
    const name = newFolderName.trim();
    if (name) file.createFolder(name);
    setIsCreatingFolder(false);
    setNewFolderName("");
  }

  function commitCreateInDir() {
    if (creatingInDir === null) return;
    const name = newFileInDirName.trim();
    if (name) file.createFile(`${creatingInDir}/${name.endsWith(".md") ? name : `${name}.md`}`);
    setCreatingInDir(null);
    setNewFileInDirName("");
  }

  function commitCreateFolderInDir() {
    if (creatingFolderInDir === null) return;
    const name = newFolderInDirName.trim();
    if (name) file.createFolder(`${creatingFolderInDir}/${name}`);
    setCreatingFolderInDir(null);
    setNewFolderInDirName("");
  }

  function commitRename() {
    if (!renamingPath) return;
    const newName = renameValue.trim();
    if (newName && newName !== basename(renamingPath)) {
      const dir = dirname(renamingPath);
      const target = newName.endsWith(".md") ? newName : `${newName}.md`;
      const newPath = dir ? `${dir}/${target}` : target;
      file.renameFile(renamingPath, newPath);
    }
    setRenamingPath(null);
    setRenameValue("");
  }

  function openRename(path: string) {
    setContextMenu(null);
    setRenamingPath(path);
    setRenameValue(basename(path).replace(/\.md$/i, ""));
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setContextMenu(null);
  }

  function openDeleteConfirm(path: string) {
    setContextMenu(null);
    setPendingDelete(path);
  }

  function openNewFileInDir(dirPath: string) {
    setContextMenu(null);
    setCreatingInDir(dirPath);
    setNewFileInDirName("");
    expandDir(dirPath);
  }

  function openNewFolderInDir(dirPath: string) {
    setContextMenu(null);
    setCreatingFolderInDir(dirPath);
    setNewFolderInDirName("");
    expandDir(dirPath);
  }

  function openInFinderAndClose(path: string) {
    file.openInFinder(path);
    setContextMenu(null);
  }

  const handleBackgroundContext = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    setContextMenu({ target: { type: "background" }, x: e.clientX, y: e.clientY });
  };

  return (
    <div
      className={`file-tree-track${collapsed ? " collapsed" : ""}`}
      style={collapsed ? undefined : { width, transition: isDragging ? "none" : undefined }}
    >
      <div className="file-tree" style={{ width, minWidth: width }}>
        {!collapsed && <ResizeHandle edge="right" onMouseDown={handleMouseDown} />}
        <FileTreeHeader
          onNewFile={() => setIsCreating(true)}
          onRefresh={file.refreshFiles}
        />

        <div
          ref={fileListRef}
          className="file-tree-list"
          onContextMenu={handleBackgroundContext}
        >
          {/* Root drop zone — only visible while dragging a file from a subdir */}
          {draggingPath && dirname(draggingPath) !== "" && (
            <div
              className={`file-tree-root-drop${dragOverDir === "" ? " active" : ""}`}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverDir(""); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDir(null); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(e, ""); }}
            >
              Drop to move to root
            </div>
          )}

          {isCreating && (
            <NewItemInput
              placeholder="filename.md or folder/file.md"
              value={newFileName}
              onChange={setNewFileName}
              onCommit={commitCreate}
              onCancel={() => { setIsCreating(false); setNewFileName(""); }}
            />
          )}

          {isCreatingFolder && (
            <NewItemInput
              placeholder="folder name"
              value={newFolderName}
              onChange={setNewFolderName}
              onCommit={commitCreateFolder}
              onCancel={() => { setIsCreatingFolder(false); setNewFolderName(""); }}
            />
          )}

          {items.length === 0 && !isCreating && !isCreatingFolder ? (
            <div className="file-tree-empty">No Markdown files found</div>
          ) : (
            items.map((item) => {
              if (item.type === "new-file-in-dir") {
                return (
                  <NewItemInput
                    key={`new-file-in-${item.dirPath}`}
                    depth={item.depth}
                    placeholder="filename.md"
                    value={newFileInDirName}
                    onChange={setNewFileInDirName}
                    onCommit={commitCreateInDir}
                    onCancel={() => { setCreatingInDir(null); setNewFileInDirName(""); }}
                  />
                );
              }

              if (item.type === "new-folder-in-dir") {
                return (
                  <NewItemInput
                    key={`new-folder-in-${item.dirPath}`}
                    depth={item.depth}
                    placeholder="folder name"
                    value={newFolderInDirName}
                    onChange={setNewFolderInDirName}
                    onCommit={commitCreateFolderInDir}
                    onCancel={() => { setCreatingFolderInDir(null); setNewFolderInDirName(""); }}
                  />
                );
              }

              if (item.type === "dir") {
                return (
                  <DirRow
                    key={item.path}
                    path={item.path}
                    label={item.label}
                    depth={item.depth}
                    collapsed={!expandedDirs.has(item.path)}
                    dragOver={dragOverDir === item.path}
                    dragging={draggingPath === item.path}
                    onToggle={() => toggleDir(item.path)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ target: { type: "dir", path: item.path }, x: e.clientX, y: e.clientY });
                    }}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", item.path);
                      e.dataTransfer.setData("text/x-episteme-kind", "folder");
                      e.dataTransfer.effectAllowed = "move";
                      setTimeout(() => setDraggingPath(item.path), 0);
                    }}
                    onDragEnd={() => { setDraggingPath(null); setDragOverDir(null); }}
                    onDragOver={(e) => {
                      if (draggingPath === item.path) return;
                      e.preventDefault();
                      setDragOverDir(item.path);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDir(null);
                    }}
                    onDrop={(e) => { e.preventDefault(); handleDrop(e, item.path); }}
                  />
                );
              }

              if (renamingPath === item.path) {
                return (
                  <RenameInput
                    key={item.path}
                    depth={item.depth}
                    value={renameValue}
                    onChange={setRenameValue}
                    onCommit={commitRename}
                    onCancel={() => { setRenamingPath(null); setRenameValue(""); }}
                  />
                );
              }

              return (
                <FileRow
                  key={item.path}
                  path={item.path}
                  label={item.label}
                  depth={item.depth}
                  active={item.path === activeFile}
                  dragging={draggingPath === item.path}
                  onOpen={() => file.openFile(item.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ target: { type: "file", path: item.path }, x: e.clientX, y: e.clientY });
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", item.path);
                    e.dataTransfer.setData("text/x-episteme-kind", "file");
                    e.dataTransfer.effectAllowed = "move";
                    setTimeout(() => setDraggingPath(item.path), 0);
                  }}
                  onDragEnd={() => { setDraggingPath(null); setDragOverDir(null); }}
                />
              );
            })
          )}
        </div>

        <FileTreeContextMenu
          target={contextMenu?.target ?? null}
          x={contextMenu?.x ?? 0}
          y={contextMenu?.y ?? 0}
          workspaceRoot={workspaceRoot}
          onClose={() => setContextMenu(null)}
          onNewFileRoot={() => { setContextMenu(null); setIsCreating(true); }}
          onNewFolderRoot={() => { setContextMenu(null); setIsCreatingFolder(true); }}
          onNewFileInDir={openNewFileInDir}
          onNewFolderInDir={openNewFolderInDir}
          onRenameFile={openRename}
          onDeleteFile={openDeleteConfirm}
          onOpenInFinder={openInFinderAndClose}
          onCopy={copyToClipboard}
        />

        <DeleteConfirmDialog
          path={pendingDelete}
          onConfirm={() => {
            if (pendingDelete) file.deleteFile(pendingDelete);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      </div>
    </div>
  );
});
