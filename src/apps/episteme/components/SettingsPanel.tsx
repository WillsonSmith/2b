import { useState, useEffect, useCallback } from "react";

interface SettingsPanelProps {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [content, setContent] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    fetch("/api/style-guide")
      .then((r) => r.json())
      .then((data: { content?: string }) => setContent(data.content ?? ""))
      .catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch("/api/style-guide", {
        method: "PATCH",
        body: content,
      });
      setStatus(res.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }, [content]);

  const handleClear = useCallback(async () => {
    setContent("");
    setStatus("saving");
    try {
      const res = await fetch("/api/style-guide", { method: "PATCH", body: "" });
      setStatus(res.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Style Guide</span>
          <button className="modal-close" onClick={onClose} title="Close">✕</button>
        </div>

        <p className="modal-desc">
          Write style rules in Markdown. Episteme injects them into every editing and generation prompt.
        </p>

        <textarea
          className="modal-textarea"
          value={content}
          onChange={(e) => { setContent(e.target.value); setStatus("idle"); }}
          placeholder={"# Style Guide\n\n- Use active voice\n- Prefer short sentences (under 25 words)\n- Avoid jargon unless the audience is technical"}
          spellCheck={false}
        />

        <div className="modal-footer">
          <button className="modal-btn-ghost" onClick={handleClear} disabled={status === "saving"}>
            Clear
          </button>
          <div style={{ flex: 1 }} />
          {status === "saved" && <span className="modal-status-ok">Saved</span>}
          {status === "error" && <span className="modal-status-err">Save failed</span>}
          <button className="modal-btn-primary" onClick={handleSave} disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
