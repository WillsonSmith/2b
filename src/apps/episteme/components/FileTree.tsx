import { useState, useRef, useEffect } from "react";
import { FileText, Plus, RotateCw } from "lucide-react";
import { OutlinePanel } from "./OutlinePanel.tsx";
import type { TocEntry } from "../features/toc.ts";

interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  onRefresh: () => void;
  onCreateFile: (path: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
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

function groupByDirectory(files: string[]): Array<{ type: "dir" | "file"; label: string; path: string }> {
  const result: Array<{ type: "dir" | "file"; label: string; path: string }> = [];
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
    for (const f of dirFiles) {
      result.push({ type: "file", label: basename(f), path: f });
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
  tocEntries,
  isTocGenerating,
  onGenerateToc,
  onHeadingClick,
}: FileTreeProps) {
  const [activeTab, setActiveTab] = useState<Tab>("files");
  const items = groupByDirectory(files);

  // New file creation state
  const [isCreating, setIsCreating] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const newFileInputRef = useRef<HTMLInputElement>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Rename state
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Focus new file input when it appears
  useEffect(() => {
    if (isCreating) newFileInputRef.current?.focus();
  }, [isCreating]);

  // Focus rename input when it appears
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

  function commitRename() {
    if (!renamingPath) return;
    const newName = renameValue.trim();
    if (newName && newName !== basename(renamingPath)) {
      const dir = dirname(renamingPath);
      const newPath = dir ? `${dir}/${newName.endsWith(".md") ? newName : `${newName}.md`}` : (newName.endsWith(".md") ? newName : `${newName}.md`);
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
              className="file-tree-refresh"
              onClick={() => setIsCreating(true)}
              title="New file"
            >
              <Plus size={14} />
            </button>
            <button
              className="file-tree-refresh"
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
          {/* New file inline input */}
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
                placeholder="filename.md"
              />
            </div>
          )}

          {items.length === 0 && !isCreating ? (
            <div className="file-tree-empty">No Markdown files found</div>
          ) : (
            items.map((item) =>
              item.type === "dir" ? (
                <div
                  key={item.path}
                  style={{
                    padding: "4px 10px 2px",
                    fontSize: 11,
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    userSelect: "none",
                  }}
                >
                  {item.label}
                </div>
              ) : renamingPath === item.path ? (
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
              ) : (
                <div
                  key={item.path}
                  className={`file-tree-item${item.path === activeFile ? " active" : ""}`}
                  onClick={() => onFileSelect(item.path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ path: item.path, x: e.clientX, y: e.clientY });
                  }}
                  title={item.path}
                >
                  <span className="file-tree-item-icon"><FileText size={12} /></span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
                </div>
              ),
            )
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
          <button
            className="file-tree-context-item"
            onClick={() => openRename(contextMenu.path)}
          >
            Rename
          </button>
        </div>
      )}
    </div>
  );
}
