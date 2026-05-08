import { useState, useRef, useEffect } from "react";
import { FileText, Plus, RotateCw, ChevronDown, ChevronRight } from "lucide-react";
import { OutlinePanel } from "./OutlinePanel.tsx";
import type { TocEntry } from "../features/toc.ts";

interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  onRefresh: () => void;
  onCreateFile: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onOpenInFinder: (path: string) => void;
  workspaceRoot: string;
  // Outline panel props
  tocEntries: TocEntry[];
  isTocGenerating: boolean;
  onGenerateToc: () => void;
  onHeadingClick: (id: string, text: string) => void;
}

type Tab = "files" | "outline";

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
  | { type: "new-file-in-dir"; dirPath: string };

function buildItems(files: string[], collapsedDirs: Set<string>, creatingInDir: string | null): TreeItem[] {
  const result: TreeItem[] = [];
  const byDir = new Map<string, string[]>();

  for (const f of files) {
    const dir = dirname(f);
    const bucket = byDir.get(dir) ?? [];
    bucket.push(f);
    byDir.set(dir, bucket);
  }

  const rootFiles = byDir.get("") ?? [];
  for (const f of rootFiles) {
    result.push({ type: "file", label: basename(f), path: f });
  }

  for (const [dir, dirFiles] of byDir) {
    if (dir === "") continue;
    result.push({ type: "dir", label: dir + "/", path: dir });
    if (!collapsedDirs.has(dir)) {
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

export function FileTree({
  files,
  activeFile,
  onFileSelect,
  onRefresh,
  onCreateFile,
  onRenameFile,
  onOpenInFinder,
  workspaceRoot,
  tocEntries,
  isTocGenerating,
  onGenerateToc,
  onHeadingClick,
}: FileTreeProps) {
  const [activeTab, setActiveTab] = useState<Tab>("files");

  // New file creation state
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const newFileInputRef = useRef<HTMLInputElement>(null);

  // Creating file inside a specific directory
  const [creatingInDir, setCreatingInDir] = useState<string | null>(null);
  const [newFileInDirName, setNewFileInDirName] = useState("");
  const newFileInDirInputRef = useRef<HTMLInputElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    path: string;
    x: number;
    y: number;
    isDir: boolean;
  } | null>(null);
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

  function toggleDir(dir: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      next.has(dir) ? next.delete(dir) : next.add(dir);
      if (workspaceRoot) {
        try {
          localStorage.setItem(
            `episteme:filetree:collapsed:${workspaceRoot}`,
            JSON.stringify([...next]),
          );
        } catch {}
      }
      return next;
    });
  }

  const items = buildItems(files, collapsedDirs, creatingInDir);

  // Focus inputs when they appear
  useEffect(() => {
    if (isCreating) newFileInputRef.current?.focus();
  }, [isCreating]);

  useEffect(() => {
    if (creatingInDir !== null) newFileInDirInputRef.current?.focus();
  }, [creatingInDir]);

  useEffect(() => {
    if (renamingPath) renameInputRef.current?.focus();
  }, [renamingPath]);

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
    if (name) {
      const path = name.endsWith(".md") ? name : `${name}.md`;
      onCreateFile(path);
    }
    setIsCreating(false);
    setNewFileName("");
  }

  function commitCreateInDir() {
    if (creatingInDir === null) return;
    const name = newFileInDirName.trim();
    if (name) {
      const filename = name.endsWith(".md") ? name : `${name}.md`;
      onCreateFile(`${creatingInDir}/${filename}`);
    }
    setCreatingInDir(null);
    setNewFileInDirName("");
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
    // Ensure dir is expanded
    setCollapsedDirs((prev) => {
      if (!prev.has(dirPath)) return prev;
      const next = new Set(prev);
      next.delete(dirPath);
      if (workspaceRoot) {
        try {
          localStorage.setItem(
            `episteme:filetree:collapsed:${workspaceRoot}`,
            JSON.stringify([...next]),
          );
        } catch {}
      }
      return next;
    });
  }

  return (
    <div className="file-tree">
      <div className="file-tree-tabs">
        <button
          className={`file-tree-tab${activeTab === "files" ? " active" : ""}`}
          onClick={() => setActiveTab("files")}
        >
          Files
        </button>
        <button
          className={`file-tree-tab${activeTab === "outline" ? " active" : ""}`}
          onClick={() => setActiveTab("outline")}
        >
          Outline
        </button>
        {activeTab === "files" && (
          <>
            <button
              className="header-icon-btn"
              onClick={() => setIsCreating(true)}
              title="New file"
            >
              <Plus size={14} />
            </button>
            <button
              className="header-icon-btn"
              onClick={onRefresh}
              title="Refresh file list"
            >
              <RotateCw size={13} />
            </button>
          </>
        )}
      </div>

      {activeTab === "files" ? (
        <div className="file-tree-list">
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

          {items.length === 0 && !isCreating ? (
            <div className="file-tree-empty">No Markdown files found</div>
          ) : (
            items.map((item) => {
              if (item.type === "new-file-in-dir") {
                return (
                  <div key={`new-in-${item.dirPath}`} className="file-tree-new-file" style={{ paddingLeft: 20 }}>
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

              if (item.type === "dir") {
                const isCollapsed = collapsedDirs.has(item.path);
                return (
                  <div
                    key={item.path}
                    className="file-tree-dir-row"
                    onClick={() => toggleDir(item.path)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ path: item.path, x: e.clientX, y: e.clientY, isDir: true });
                    }}
                    title={item.path}
                  >
                    <span className="file-tree-dir-chevron">
                      {isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    </span>
                    <span>{item.label}</span>
                  </div>
                );
              }

              // file
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

              return (
                <div
                  key={item.path}
                  className={`file-tree-item${item.path === activeFile ? " active" : ""}`}
                  onClick={() => onFileSelect(item.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ path: item.path, x: e.clientX, y: e.clientY, isDir: false });
                  }}
                  title={item.path}
                >
                  <span className="file-tree-item-icon"><FileText size={12} /></span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <OutlinePanel
          entries={tocEntries}
          isGenerating={isTocGenerating}
          onGenerate={onGenerateToc}
          onHeadingClick={onHeadingClick}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="file-tree-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.isDir ? (
            <>
              <button
                className="file-tree-context-item"
                onClick={() => openNewFileInDir(contextMenu.path)}
              >
                New file here
              </button>
              <div className="file-tree-context-separator" />
              <button
                className="file-tree-context-item"
                onClick={() => copyToClipboard(basename(contextMenu.path))}
              >
                Copy name
              </button>
              <button
                className="file-tree-context-item"
                onClick={() => copyToClipboard(contextMenu.path)}
              >
                Copy path
              </button>
              {workspaceRoot && (
                <button
                  className="file-tree-context-item"
                  onClick={() => copyToClipboard(`${workspaceRoot}/${contextMenu.path}`)}
                >
                  Copy absolute path
                </button>
              )}
              <div className="file-tree-context-separator" />
              <button
                className="file-tree-context-item"
                onClick={() => { onOpenInFinder(contextMenu.path); setContextMenu(null); }}
              >
                Open in Finder
              </button>
            </>
          ) : (
            <>
              <button
                className="file-tree-context-item"
                onClick={() => openRename(contextMenu.path)}
              >
                Rename
              </button>
              <div className="file-tree-context-separator" />
              <button
                className="file-tree-context-item"
                onClick={() => copyToClipboard(basename(contextMenu.path))}
              >
                Copy name
              </button>
              <button
                className="file-tree-context-item"
                onClick={() => copyToClipboard(contextMenu.path)}
              >
                Copy path
              </button>
              {workspaceRoot && (
                <button
                  className="file-tree-context-item"
                  onClick={() => copyToClipboard(`${workspaceRoot}/${contextMenu.path}`)}
                >
                  Copy absolute path
                </button>
              )}
              <div className="file-tree-context-separator" />
              <button
                className="file-tree-context-item"
                onClick={() => { onOpenInFinder(contextMenu.path); setContextMenu(null); }}
              >
                Open in Finder
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
