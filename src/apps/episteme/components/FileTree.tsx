interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  onFileSelect: (path: string) => void;
  onRefresh: () => void;
}

function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

function dirname(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

/** Group flat file paths into a display list with optional directory headers. */
function groupByDirectory(files: string[]): Array<{ type: "dir" | "file"; label: string; path: string }> {
  const result: Array<{ type: "dir" | "file"; label: string; path: string }> = [];
  const byDir = new Map<string, string[]>();

  for (const f of files) {
    const dir = dirname(f);
    const bucket = byDir.get(dir) ?? [];
    bucket.push(f);
    byDir.set(dir, bucket);
  }

  // Root files first
  const rootFiles = byDir.get("") ?? [];
  for (const f of rootFiles) {
    result.push({ type: "file", label: basename(f), path: f });
  }

  // Then subdirectories
  for (const [dir, dirFiles] of byDir) {
    if (dir === "") continue;
    result.push({ type: "dir", label: dir + "/", path: dir });
    for (const f of dirFiles) {
      result.push({ type: "file", label: basename(f), path: f });
    }
  }

  return result;
}

export function FileTree({ files, activeFile, onFileSelect, onRefresh }: FileTreeProps) {
  const items = groupByDirectory(files);

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span>Files</span>
        <button onClick={onRefresh} title="Refresh file list">↺</button>
      </div>
      <div className="file-tree-list">
        {items.length === 0 ? (
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
            ) : (
              <div
                key={item.path}
                className={`file-tree-item${item.path === activeFile ? " active" : ""}`}
                onClick={() => onFileSelect(item.path)}
                title={item.path}
              >
                <span className="file-tree-item-icon">📄</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}
