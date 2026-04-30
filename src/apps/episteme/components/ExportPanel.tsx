import { useState } from "react";
import type { ExportFormat } from "../features/export.ts";

interface ExportPanelProps {
  onClose: () => void;
  onExport: (format: ExportFormat, includeFrontmatter: boolean) => void;
  isExporting: boolean;
  pandocAvailable: boolean;
  activeFile: string | null;
}

export function ExportPanel({
  onClose,
  onExport,
  isExporting,
  pandocAvailable,
  activeFile,
}: ExportPanelProps) {
  const [format, setFormat] = useState<ExportFormat>("html");
  const [includeFrontmatter, setIncludeFrontmatter] = useState(true);

  const canExport = pandocAvailable && !!activeFile && !isExporting;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Export Document</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {!pandocAvailable && (
          <div className="export-warning">
            Pandoc not installed. Run <code>brew install pandoc</code> to enable export.
          </div>
        )}
        {!activeFile && (
          <div className="export-warning">No file open — open a document first.</div>
        )}

        <div className="export-field">
          <div className="export-field-label">Format</div>
          <div className="export-format-group">
            {(["html", "pdf"] as ExportFormat[]).map((f) => (
              <button
                key={f}
                className={`export-format-btn${format === f ? " active" : ""}`}
                onClick={() => setFormat(f)}
                disabled={isExporting}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <label className="export-checkbox-row">
          <input
            type="checkbox"
            checked={includeFrontmatter}
            onChange={(e) => setIncludeFrontmatter(e.target.checked)}
            disabled={isExporting}
          />
          Include YAML frontmatter
        </label>

        <div className="modal-footer">
          <button
            className="modal-btn-primary"
            disabled={!canExport}
            onClick={() => onExport(format, includeFrontmatter)}
          >
            {isExporting ? "Exporting…" : `Export as ${format.toUpperCase()}`}
          </button>
          <button className="modal-btn-ghost" onClick={onClose} disabled={isExporting}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
