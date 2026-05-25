import { useState, useRef, useEffect, useMemo, memo } from "react";
import { FileText, Plus, RotateCw, ChevronDown, ChevronRight } from "lucide-react";
import { usePanelResize } from "../hooks/usePanelResize.ts";
import { useFiles } from "../state/FileContext.tsx";
import { useUI } from "../state/UIContext.tsx";
import { useSignalValue } from "../state/signals.ts";

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function dirname(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

type TreeItem =
  | { type: "dir"; label: string; path: string; depth: number }
  | { type: "file"; label: string; path: string; depth: number }
  | { type: "new-file-in-dir"; dirPath: string; depth: number }
  | { type: "new-folder-in-dir"; dirPath: string; depth: number };

function buildItems(
  files: string[],
  folders: string[],
  expandedDirs: Set<string>,
  creatingInDir: string | null,
  creatingFolderInDir: string | null,
): TreeItem[] {
  const result: TreeItem[] = [];

  // Collect all directory paths including intermediate ancestors
  const allDirPaths = new Set<string>();
  for (const f of files) {
    let d = dirname(f);
    while (d) { allDirPaths.add(d); d = dirname(d); }
  }
  for (const folder of folders) {
    let d = folder;
    while (d) { allDirPaths.add(d); d = dirname(d); }
  }

  const filesByDir = new Map<string, string[]>();
  for (const f of files) {
    const d = dirname(f);
    const bucket = filesByDir.get(d) ?? [];
    bucket.push(f);
    filesByDir.set(d, bucket);
  }

  function getChildDirs(parentPath: string): string[] {
    return [...allDirPaths]
      .filter((d) =>
        parentPath === ""
          ? !d.includes("/")
          : d.startsWith(parentPath + "/") && !d.slice(parentPath.length + 1).includes("/"),
      )
      .sort();
  }

  function addDir(dirPath: string, depth: number) {
    result.push({ type: "dir", label: basename(dirPath) + "/", path: dirPath, depth });
    if (!expandedDirs.has(dirPath)) return;

    if (creatingFolderInDir === dirPath)
      result.push({ type: "new-folder-in-dir", dirPath, depth: depth + 1 });
    if (creatingInDir === dirPath)
      result.push({ type: "new-file-in-dir", dirPath, depth: depth + 1 });

    for (const child of getChildDirs(dirPath)) addDir(child, depth + 1);
    for (const f of filesByDir.get(dirPath) ?? [])
      result.push({ type: "file", label: basename(f), path: f, depth: depth + 1 });
  }

  for (const f of filesByDir.get("") ?? [])
    result.push({ type: "file", label: basename(f), path: f, depth: 0 });

  for (const dir of getChildDirs("")) addDir(dir, 0);

  return result;
}

type ContextMenuState = {
  type: "file" | "dir" | "background";
  path: string;
  x: number;
  y: number;
} | null;

function IndentGuides({ depth }: { depth: number }) {
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} className="file-tree-guide-line" />
      ))}
    </>
  );
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

  // New file creation state (root level)
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const newFileInputRef = useRef<HTMLInputElement>(null);

  // New folder creation state (root level)
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  // Creating file inside a specific directory
  const [creatingInDir, setCreatingInDir] = useState<string | null>(null);
  const [newFileInDirName, setNewFileInDirName] = useState("");
  const newFileInDirInputRef = useRef<HTMLInputElement>(null);

  // Creating folder inside a specific directory
  const [creatingFolderInDir, setCreatingFolderInDir] = useState<string | null>(null);
  const [newFolderInDirName, setNewFolderInDirName] = useState("");
  const newFolderInDirInputRef = useRef<HTMLInputElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Pending delete confirmation
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const fileListRef = useRef<HTMLDivElement>(null);

  // Expand state — persisted to the workspace DB (see useFileTreeState).
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set(initialExpandedDirs));

  // Re-sync expand state when the server-provided initial value changes.
  const lastInitialRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (lastInitialRef.current === initialExpandedDirs) return;
    lastInitialRef.current = initialExpandedDirs;
    setExpandedDirs(new Set(initialExpandedDirs));
  }, [initialExpandedDirs]);

  function toggleDir(dir: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      next.has(dir) ? next.delete(dir) : next.add(dir);
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

  // Drag and drop state
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);

  function handleDrop(e: React.DragEvent, targetDir: string) {
    const kind = e.dataTransfer.getData("text/x-episteme-kind");
    const path = e.dataTransfer.getData("text/plain");
    if (!path) return;

    if (kind === "folder") {
      if (path === targetDir) return; // can't drop into itself
      if (targetDir.startsWith(path + "/")) return; // can't drop into a child
      if (dirname(path) === targetDir) return; // already here
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

  // Focus inputs when they appear
  useEffect(() => { if (isCreating) newFileInputRef.current?.focus(); }, [isCreating]);
  useEffect(() => { if (isCreatingFolder) newFolderInputRef.current?.focus(); }, [isCreatingFolder]);
  useEffect(() => { if (creatingInDir !== null) newFileInDirInputRef.current?.focus(); }, [creatingInDir]);
  useEffect(() => { if (creatingFolderInDir !== null) newFolderInDirInputRef.current?.focus(); }, [creatingFolderInDir]);
  useEffect(() => { if (renamingPath) renameInputRef.current?.focus(); }, [renamingPath]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  // Esc cancels the delete confirmation
  useEffect(() => {
    if (!pendingDelete) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingDelete(null);
      if (e.key === "Enter") confirmDelete();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pendingDelete]);

  // Scroll the active file into view when it changes (reveal-in-tree).
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
      const newPath = dir
        ? `${dir}/${newName.endsWith(".md") ? newName : `${newName}.md`}`
        : newName.endsWith(".md") ? newName : `${newName}.md`;
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

  function confirmDelete() {
    if (pendingDelete) file.deleteFile(pendingDelete);
    setPendingDelete(null);
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

  return (
    <div
      className={`file-tree-track${collapsed ? " collapsed" : ""}`}
      style={collapsed ? undefined : { width, transition: isDragging ? "none" : undefined }}
    >
    <div className="file-tree" style={{ width, minWidth: width }}>
      {!collapsed && <div className="panel-drag-handle panel-drag-handle--right" onMouseDown={handleMouseDown} />}
      <div className="file-tree-tabs">
        <span className="file-tree-tab active">Files</span>
        <button className="header-icon-btn" onClick={() => setIsCreating(true)} title="New file">
          <Plus size={14} />
        </button>
        <button className="header-icon-btn" onClick={file.refreshFiles} title="Refresh file list">
          <RotateCw size={13} />
        </button>
      </div>

      <div
        ref={fileListRef}
        className="file-tree-list"
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          setContextMenu({ type: "background", path: "", x: e.clientX, y: e.clientY });
        }}
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

        {/* New file inline input (root level) */}
        {isCreating && (
          <div className="file-tree-new-file">
            <input
              ref={newFileInputRef}
              className="file-tree-rename-input"
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCreate();
                if (e.key === "Escape") { setIsCreating(false); setNewFileName(""); }
              }}
              onBlur={commitCreate}
              placeholder="filename.md or folder/file.md"
            />
          </div>
        )}

        {/* New folder inline input (root level) */}
        {isCreatingFolder && (
          <div className="file-tree-new-file">
            <input
              ref={newFolderInputRef}
              className="file-tree-rename-input"
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitCreateFolder();
                if (e.key === "Escape") { setIsCreatingFolder(false); setNewFolderName(""); }
              }}
              onBlur={commitCreateFolder}
              placeholder="folder name"
            />
          </div>
        )}

        {items.length === 0 && !isCreating && !isCreatingFolder ? (
          <div className="file-tree-empty">No Markdown files found</div>
        ) : (
          items.map((item) => {
            if (item.type === "new-file-in-dir") {
              return (
                <div key={`new-file-in-${item.dirPath}`} className="file-tree-new-file" style={{ display: "flex", alignItems: "center", paddingLeft: 6, paddingRight: 6 }}>
                  <IndentGuides depth={item.depth} />
                  <input
                    ref={newFileInDirInputRef}
                    className="file-tree-rename-input"
                    style={{ flex: 1, width: "auto" }}
                    type="text"
                    value={newFileInDirName}
                    onChange={(e) => setNewFileInDirName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitCreateInDir();
                      if (e.key === "Escape") { setCreatingInDir(null); setNewFileInDirName(""); }
                    }}
                    onBlur={commitCreateInDir}
                    placeholder="filename.md"
                  />
                </div>
              );
            }

            if (item.type === "new-folder-in-dir") {
              return (
                <div key={`new-folder-in-${item.dirPath}`} className="file-tree-new-file" style={{ display: "flex", alignItems: "center", paddingLeft: 6, paddingRight: 6 }}>
                  <IndentGuides depth={item.depth} />
                  <input
                    ref={newFolderInDirInputRef}
                    className="file-tree-rename-input"
                    style={{ flex: 1, width: "auto" }}
                    type="text"
                    value={newFolderInDirName}
                    onChange={(e) => setNewFolderInDirName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitCreateFolderInDir();
                      if (e.key === "Escape") { setCreatingFolderInDir(null); setNewFolderInDirName(""); }
                    }}
                    onBlur={commitCreateFolderInDir}
                    placeholder="folder name"
                  />
                </div>
              );
            }

            if (item.type === "dir") {
              const isCollapsed = !expandedDirs.has(item.path);
              return (
                <div
                  key={item.path}
                  className={`file-tree-dir-row${dragOverDir === item.path ? " drag-over" : ""}${draggingPath === item.path ? " dragging" : ""}`}
                  draggable
                  onClick={() => toggleDir(item.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ type: "dir", path: item.path, x: e.clientX, y: e.clientY });
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
                  title={item.path}
                >
                  <IndentGuides depth={item.depth} />
                  <span className="file-tree-dir-chevron">
                    {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                  </span>
                  <span>{item.label}</span>
                </div>
              );
            }

            // file — rename input
            if (renamingPath === item.path) {
              return (
                <div key={item.path} className="file-tree-item active" style={{ paddingLeft: 6 }}>
                  <IndentGuides depth={item.depth} />
                  <input
                    ref={renameInputRef}
                    className="file-tree-rename-input"
                    style={{ flex: 1, width: "auto" }}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") { setRenamingPath(null); setRenameValue(""); }
                    }}
                    onBlur={commitRename}
                  />
                </div>
              );
            }

            // file — normal
            return (
              <div
                key={item.path}
                data-path={item.path}
                className={`file-tree-item${item.path === activeFile ? " active" : ""}${draggingPath === item.path ? " dragging" : ""}`}
                draggable
                onClick={() => file.openFile(item.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setContextMenu({ type: "file", path: item.path, x: e.clientX, y: e.clientY });
                }}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", item.path);
                  e.dataTransfer.setData("text/x-episteme-kind", "file");
                  e.dataTransfer.effectAllowed = "move";
                  setTimeout(() => setDraggingPath(item.path), 0);
                }}
                onDragEnd={() => { setDraggingPath(null); setDragOverDir(null); }}
                title={item.path}
                style={{ paddingLeft: 6 }}
              >
                <IndentGuides depth={item.depth} />
                <span className="file-tree-item-icon"><FileText size={12} /></span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="file-tree-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.type === "background" && (
            <>
              <button className="file-tree-context-item" onClick={() => { setContextMenu(null); setIsCreating(true); }}>
                New file
              </button>
              <button className="file-tree-context-item" onClick={() => { setContextMenu(null); setIsCreatingFolder(true); }}>
                New folder
              </button>
            </>
          )}

          {contextMenu.type === "dir" && (
            <>
              <button className="file-tree-context-item" onClick={() => openNewFileInDir(contextMenu.path)}>
                New file here
              </button>
              <button className="file-tree-context-item" onClick={() => openNewFolderInDir(contextMenu.path)}>
                New folder here
              </button>
              <div className="file-tree-context-separator" />
              <button className="file-tree-context-item" onClick={() => copyToClipboard(basename(contextMenu.path))}>
                Copy name
              </button>
              <button className="file-tree-context-item" onClick={() => copyToClipboard(contextMenu.path)}>
                Copy path
              </button>
              {workspaceRoot && (
                <button className="file-tree-context-item" onClick={() => copyToClipboard(`${workspaceRoot}/${contextMenu.path}`)}>
                  Copy absolute path
                </button>
              )}
              <div className="file-tree-context-separator" />
              <button className="file-tree-context-item" onClick={() => { file.openInFinder(contextMenu.path); setContextMenu(null); }}>
                Open in Finder
              </button>
            </>
          )}

          {contextMenu.type === "file" && (
            <>
              <button className="file-tree-context-item" onClick={() => openRename(contextMenu.path)}>
                Rename
              </button>
              <div className="file-tree-context-separator" />
              <button className="file-tree-context-item" onClick={() => openDeleteConfirm(contextMenu.path)}>
                Delete
              </button>
              <div className="file-tree-context-separator" />
              <button className="file-tree-context-item" onClick={() => copyToClipboard(basename(contextMenu.path))}>
                Copy name
              </button>
              <button className="file-tree-context-item" onClick={() => copyToClipboard(contextMenu.path)}>
                Copy path
              </button>
              {workspaceRoot && (
                <button className="file-tree-context-item" onClick={() => copyToClipboard(`${workspaceRoot}/${contextMenu.path}`)}>
                  Copy absolute path
                </button>
              )}
              <div className="file-tree-context-separator" />
              <button className="file-tree-context-item" onClick={() => { file.openInFinder(contextMenu.path); setContextMenu(null); }}>
                Open in Finder
              </button>
            </>
          )}
        </div>
      )}

      {pendingDelete && (
        <div className="file-tree-confirm-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="file-tree-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="file-tree-confirm-message">
              Delete <strong>{basename(pendingDelete)}</strong>?
            </div>
            <div className="file-tree-confirm-detail">This cannot be undone.</div>
            <div className="file-tree-confirm-actions">
              <button className="file-tree-confirm-btn" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button
                className="file-tree-confirm-btn file-tree-confirm-btn--danger"
                onClick={confirmDelete}
                autoFocus
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
});
