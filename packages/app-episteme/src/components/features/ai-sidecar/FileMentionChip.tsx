import { useState, type SyntheticEvent } from "react";

interface FileMentionChipProps {
  path: string;
  onRemove?: () => void;
}

export function FileMentionChip({ path, onRemove }: FileMentionChipProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const short = path.split("/").at(-1) ?? path;

  const handleToggle = (e: SyntheticEvent<HTMLDetailsElement>) => {
    if (!e.currentTarget.open || content !== null || loading) return;
    setLoading(true);
    fetch(`/api/file-content?path=${encodeURIComponent(path)}`)
      .then((r) => r.json() as Promise<{ content?: string }>)
      .then((d) => {
        if (d.content != null) setContent(d.content);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  return (
    <details className="ep-sidecar__mention-chip" onToggle={handleToggle}>
      <summary className="ep-sidecar__mention-chip-summary">
        <span className="ep-sidecar__mention-chip-name">@{short}</span>
        {onRemove && (
          <button
            className="ep-sidecar__mention-chip-remove"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }}
            title="Remove reference"
            type="button"
          >
            ×
          </button>
        )}
      </summary>
      <div className="ep-sidecar__mention-chip-content">
        {loading && <span className="ep-sidecar__mention-chip-loading">Loading…</span>}
        {error && <span className="ep-sidecar__mention-chip-error">Could not load file.</span>}
        {content !== null && <pre className="ep-sidecar__mention-chip-pre">{content}</pre>}
      </div>
    </details>
  );
}
