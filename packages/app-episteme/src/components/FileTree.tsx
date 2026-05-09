import { useState, useRef, useEffect } from "react";
import { FileText, Folder, Plus, RotateCw, ChevronDown, ChevronRight } from "lucide-react";

interface FileTreeProps {
  files: string[];
  folders?: string[];
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  onRefresh: () => void;
  onCreateFile: (path: string) => void;
  onCreateFolder?: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onRenameFolder?: (oldPath: string, newPath: string) => void;
  onOpenInFinder: (path: string) => void;
  workspaceRoot: string;
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function dirname(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

type TreeItem =
  | { type: "dir"; label: string; path: string }
  | { type: "file"; label: string; path: string }
  | { type: "new-file-in-dir"; dirPath: string }
  | { type: "new-folder-in-dir"; dirPath: string };

function buildItems(
  files: string[],
  folders: string[],
  collapsedDirs: Set<string>,
  creatingInDir: string | null,
  creatingFolderInDir: string | null,
): TreeItem[] {
  const result: TreeItem[] = [];
  const byDir = new Map<string, string[]>();

  for (const f of files) {
    const dir = dirname(f);
    const bucket = byDir.get(dir) ?? [];
    bucket.push(f);
    byDir.set(dir, bucket);
  }

  // Ensure empty folders appear in the map (with an empty file list)
  for (const folder of folders) {
    if (!byDir.has(folder)) byDir.set(folder, []);
  }

  const rootFiles = byDir.get("") ?? [];
  for (const f of rootFiles) {
    result.push({ type: "file", label: basename(f), path: f });
  }

  const dirs = [...byDir.keys()].filter((d) => d !== "").sort();
  for (const dir of dirs) {
    const dirFiles = byDir.get(dir) ?? [];
    result.push({ type: "dir", label: dir + "/", path: dir });
    if (!collapsedDirs.has(dir)) {
      if (creatingFolderInDir === dir) {
        result.push({ type: "new-folder-in-dir", dirPath: dir });
      }
      if (creatingInDir === dir) {
        result.push({ type: "new-file-in-dir", dirPath: dir });
      }
      for (const f of dirFiles) {
        result.push({ type: "file", label: basename(f), path: f });
      }
    }
  }

  return result;
}

type ContextMenuState = {
  type: "file" | "dir" | "background";
  path: string;
  x: number;
  y: number;
} | null;

export function FileTree({
  files,
  folders = [],
  activeFile,
  onFileSelect,
  onRefresh,
  onCreateFile,
  onCreateFolder,
  onRenameFile,
  onRenameFolder,
  onOpenInFinder,
  workspaceRoot,
}: FileTreeProps) {
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

  // Collapse state — persisted to localStorage per workspace
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => {
    if (!workspaceRoot) return new Set();
    try {
      const stored = localStorage.getItem(`episteme:filetree:collapsed:${workspaceRoot}`);
      return new Set(stored ? JSON.parse(stored) : []);
    } catch {
      return new Set();
    }
  });

  // Re-initialize collapse state when workspaceRoot becomes available
  useEffect(() => {
    if (!workspaceRoot) return;
    try {
      const stored = localStorage.getItem(`episteme:filetree:collapsed:${workspaceRoot}`);
      setCollapsedDirs(new Set(stored ? JSON.parse(stored) : []));
    } catch {
      setCollapsedDirs(new Set());
    }
  }, [workspaceRoot]);

  function persistCollapsed(next: Set<string>) {
    if (!workspaceRoot) return;
    try {
      localStorage.setItem(`episteme:filetree:collapsed:${workspaceRoot}`, JSON.stringify([...next]));
    } catch {}
  }

  function toggleDir(dir: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      next.has(dir) ? next.delete(dir) : next.add(dir);
      persistCollapsed(next);
      return next;
    });
  }

  function expandDir(dir: string) {
    setCollapsedDirs((prev) => {
      if (!prev.has(dir)) return prev;
      const next = new Set(prev);
      next.delete(dir);
      persistCollapsed(next);
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
      onRenameFolder?.(path, newPath);
    } else {
      if (dirname(path) === targetDir) return;
      const newPath = targetDir ? `${targetDir}/${basename(path)}` : basename(path);
      onRenameFile(path, newPath);
      expandDir(targetDir);
    }

    setDraggingPath(null);
    setDragOverDir(null);
  }

  const items = buildItems(files, folders, collapsedDirs, creatingInDir, creatingFolderInDir);

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

  function commitCreate() {
    const name = newFileName.trim();
    if (name) onCreateFile(name.endsWith(".md") ? name : `${name}.md`);
    setIsCreating(false);
    setNewFileName("");
  }

  function commitCreateFolder() {
    const name = newFolderName.trim();
    if (name) onCreateFolder?.(name);
    setIsCreatingFolder(false);
    setNewFolderName("");
  }

  function commitCreateInDir() {
    if (creatingInDir === null) return;
    const name = newFileInDirName.trim();
    if (name) onCreateFile(`${creatingInDir}/${name.endsWith(".md") ? name : `${name}.md`}`);
    setCreatingInDir(null);
    setNewFileInDirName("");
  }

  function commitCreateFolderInDir() {
    if (creatingFolderInDir === null) return;
    const name = newFolderInDirName.trim();
    if (name) onCreateFolder?.(`${creatingFolderInDir}/${name}`);
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
      onRenameFile(renamingPath, newPath);
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
    <div className="file-tree">
      <div className="file-tree-tabs">
        <span className="file-tree-tab active">Files</span>
        <button className="header-icon-btn" onClick={() => setIsCreating(true)} title="New file">
          <Plus size={14} />
        </button>
        <button className="header-icon-btn" onClick={onRefresh} title="Refresh file list">
          <RotateCw size={13} />
        </button>
      </div>

      <div
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
                <div key={`new-file-in-${item.dirPath}`} className="file-tree-new-file" style={{ paddingLeft: 20 }}>
                  <input
                    ref={newFileInDirInputRef}
                    className="file-tree-rename-input"
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
                <div key={`new-folder-in-${item.dirPath}`} className="file-tree-new-file" style={{ paddingLeft: 20 }}>
                  <input
                    ref={newFolderInDirInputRef}
                    className="file-tree-rename-input"
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
              const isCollapsed = collapsedDirs.has(item.path);
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
                <div key={item.path} className="file-tree-item active">
                  <input
                    ref={renameInputRef}
                    className="file-tree-rename-input"
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
                className={`file-tree-item${item.path === activeFile ? " active" : ""}${draggingPath === item.path ? " dragging" : ""}`}
                draggable
                onClick={() => onFileSelect(item.path)}
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
              >
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
              {onCreateFolder && (
                <button className="file-tree-context-item" onClick={() => { setContextMenu(null); setIsCreatingFolder(true); }}>
                  New folder
                </button>
              )}
            </>
          )}

          {contextMenu.type === "dir" && (
            <>
              <button className="file-tree-context-item" onClick={() => openNewFileInDir(contextMenu.path)}>
                New file here
              </button>
              {onCreateFolder && (
                <button className="file-tree-context-item" onClick={() => openNewFolderInDir(contextMenu.path)}>
                  New folder here
                </button>
              )}
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
              <button className="file-tree-context-item" onClick={() => { onOpenInFinder(contextMenu.path); setContextMenu(null); }}>
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
              <button className="file-tree-context-item" onClick={() => { onOpenInFinder(contextMenu.path); setContextMenu(null); }}>
                Open in Finder
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
