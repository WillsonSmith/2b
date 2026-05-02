import { useState, useEffect, useCallback } from "react";

interface ModelConfig {
  default: string;
  autocomplete?: string;
  linting?: string;
  research?: string;
  export?: string;
}

interface SettingsPanelProps {
  onClose: () => void;
  onAutocompleteEnabledChange?: (enabled: boolean) => void;
  onAutosaveEnabledChange?: (enabled: boolean) => void;
}

const FEATURE_LABELS: Array<{ key: keyof ModelConfig; label: string; desc: string }> = [
  { key: "default", label: "Default", desc: "General chat and structural tasks" },
  { key: "autocomplete", label: "Autocomplete", desc: "Inline ghost-text suggestions" },
  { key: "linting", label: "Linting", desc: "AI writing quality checks (runs on save)" },
  { key: "research", label: "Research", desc: "Gap detection and deep research synthesis" },
];

export function SettingsPanel({ onClose, onAutocompleteEnabledChange, onAutosaveEnabledChange }: SettingsPanelProps) {
  // Style guide state
  const [content, setContent] = useState("");
  const [styleStatus, setStyleStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Model config state
  const [models, setModels] = useState<string[]>([]);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({ default: "" });
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [modelStatus, setModelStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [activeTab, setActiveTab] = useState<"style" | "models">("style");

  useEffect(() => {
    fetch("/api/style-guide")
      .then((r) => r.json())
      .then((data: { content?: string }) => setContent(data.content ?? ""))
      .catch(() => {});

    fetch("/api/config")
      .then((r) => r.json())
      .then((data: { models?: ModelConfig; features?: { autocomplete?: boolean; autosave?: boolean } }) => {
        if (data.models) setModelConfig(data.models);
        if (data.features?.autocomplete !== undefined) setAutocompleteEnabled(data.features.autocomplete);
        if (data.features?.autosave !== undefined) setAutosaveEnabled(data.features.autosave);
      })
      .catch(() => {});

    fetch("/api/models")
      .then((r) => r.json())
      .then((data: { models?: string[] }) => setModels(data.models ?? []))
      .catch(() => {});
  }, []);

  const handleStyleSave = useCallback(async () => {
    setStyleStatus("saving");
    try {
      const res = await fetch("/api/style-guide", { method: "PATCH", body: content });
      setStyleStatus(res.ok ? "saved" : "error");
    } catch {
      setStyleStatus("error");
    }
  }, [content]);

  const handleStyleClear = useCallback(async () => {
    setContent("");
    setStyleStatus("saving");
    try {
      const res = await fetch("/api/style-guide", { method: "PATCH", body: "" });
      setStyleStatus(res.ok ? "saved" : "error");
    } catch {
      setStyleStatus("error");
    }
  }, []);

  const handleModelSave = useCallback(async () => {
    setModelStatus("saving");
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models: modelConfig, features: { autocomplete: autocompleteEnabled, autosave: autosaveEnabled } }),
      });
      if (res.ok) {
        onAutocompleteEnabledChange?.(autocompleteEnabled);
        onAutosaveEnabledChange?.(autosaveEnabled);
        setModelStatus("saved");
      } else {
        setModelStatus("error");
      }
    } catch {
      setModelStatus("error");
    }
  }, [modelConfig, autocompleteEnabled, autosaveEnabled, onAutocompleteEnabledChange, onAutosaveEnabledChange]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="modal-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="settings-tabs">
          <button
            className={`settings-tab${activeTab === "style" ? " active" : ""}`}
            onClick={() => setActiveTab("style")}
          >
            Style Guide
          </button>
          <button
            className={`settings-tab${activeTab === "models" ? " active" : ""}`}
            onClick={() => setActiveTab("models")}
          >
            Models
          </button>
        </div>

        {activeTab === "style" ? (
          <>
            <p className="modal-desc">
              Write style rules in Markdown. Episteme injects them into every editing and generation prompt.
            </p>
            <textarea
              className="modal-textarea"
              value={content}
              onChange={(e) => { setContent(e.target.value); setStyleStatus("idle"); }}
              placeholder={"# Style Guide\n\n- Use active voice\n- Prefer short sentences (under 25 words)\n- Avoid jargon unless the audience is technical"}
              spellCheck={false}
            />
            <div className="modal-footer">
              <button className="modal-btn-ghost" onClick={handleStyleClear} disabled={styleStatus === "saving"}>
                Clear
              </button>
              <div style={{ flex: 1 }} />
              {styleStatus === "saved" && <span className="modal-status-ok">Saved</span>}
              {styleStatus === "error" && <span className="modal-status-err">Save failed</span>}
              <button className="modal-btn-primary" onClick={handleStyleSave} disabled={styleStatus === "saving"}>
                {styleStatus === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="modal-desc">
              Assign different Ollama models per feature. Leave a feature on "Default" to inherit the default model.
            </p>
            <div className="model-config-row" style={{ marginBottom: 4 }}>
              <div className="model-config-label">
                <span className="model-config-name">Autosave</span>
                <span className="model-config-desc">Automatically save after 2 seconds of inactivity</span>
              </div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={autosaveEnabled}
                  onChange={(e) => { setAutosaveEnabled(e.target.checked); setModelStatus("idle"); }}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>
            <div className="model-config-row" style={{ marginBottom: 8 }}>
              <div className="model-config-label">
                <span className="model-config-name">Autocomplete</span>
                <span className="model-config-desc">Enable inline ghost-text suggestions while typing</span>
              </div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={autocompleteEnabled}
                  onChange={(e) => { setAutocompleteEnabled(e.target.checked); setModelStatus("idle"); }}
                />
                <span className="settings-toggle-track" />
              </label>
            </div>
            <div className="model-config-grid">
              {FEATURE_LABELS.map(({ key, label, desc }) => (
                <div key={key} className="model-config-row">
                  <div className="model-config-label">
                    <span className="model-config-name">{label}</span>
                    <span className="model-config-desc">{desc}</span>
                  </div>
                  <select
                    className="model-config-select"
                    value={key === "default" ? modelConfig.default : (modelConfig[key] ?? "")}
                    onChange={(e) => {
                      const val = e.target.value;
                      setModelConfig((prev) => {
                        if (key === "default") return { ...prev, default: val };
                        if (!val) {
                          const next = { ...prev };
                          delete next[key];
                          return next;
                        }
                        return { ...prev, [key]: val };
                      });
                      setModelStatus("idle");
                    }}
                  >
                    {key !== "default" && <option value="">Default ({modelConfig.default || "not set"})</option>}
                    {models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    {models.length === 0 && (
                      <option value="" disabled>No Ollama models found</option>
                    )}
                  </select>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <div style={{ flex: 1 }} />
              {modelStatus === "saved" && <span className="modal-status-ok">Saved</span>}
              {modelStatus === "error" && <span className="modal-status-err">Save failed</span>}
              <button className="modal-btn-primary" onClick={handleModelSave} disabled={modelStatus === "saving"}>
                {modelStatus === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
