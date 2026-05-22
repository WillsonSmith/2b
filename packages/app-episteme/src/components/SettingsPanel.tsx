import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft } from "lucide-react";

interface ModelConfig {
  default: string;
  autocomplete?: string;
  linting?: string;
  research?: string;
  export?: string;
}

type SettingsSection = "style" | "models" | "help";

interface SettingsPanelProps {
  onClose: () => void;
  onAutocompleteEnabledChange?: (enabled: boolean) => void;
  onAutosaveEnabledChange?: (enabled: boolean) => void;
  onLintEnabledChange?: (enabled: boolean) => void;
  initialSection?: SettingsSection;
}

const SHORTCUTS = [
  { key: "⌘P", desc: "Open search & actions" },
  { key: "⌘S", desc: "Save file" },
  { key: "⌘F", desc: "Find in document" },
  { key: "⌘K", desc: "Insert link (in editor)" },
  { key: "⌘Z / ⌘⇧Z", desc: "Undo / Redo" },
  { key: "⌘B", desc: "Bold" },
  { key: "⌘I", desc: "Italic" },
  { key: "Tab", desc: "Accept ghost-text autocomplete" },
  { key: "Esc", desc: "Dismiss autocomplete" },
  { key: "Enter after /diagram: …", desc: "Generate Mermaid diagram" },
  { key: "Enter after /fill …", desc: "Insert AI fill block" },
  { key: "Shift+Enter in fill block", desc: "Generate AI fill content" },
  { key: "F1", desc: "Show keyboard shortcuts" },
  { key: "Select text → bubble menu", desc: "Tone rewrite, TL;DR, Table" },
  { key: "Paste/drop image", desc: "Insert image with AI alt text" },
  { key: "Hover code block", desc: "Explain code with AI" },
];

const FEATURE_LABELS: Array<{ key: keyof ModelConfig; label: string; desc: string }> = [
  { key: "default", label: "Default", desc: "General chat and structural tasks" },
  { key: "autocomplete", label: "Autocomplete", desc: "Inline ghost-text suggestions" },
  { key: "linting", label: "Linting", desc: "AI writing quality checks (runs on save)" },
  { key: "research", label: "Research", desc: "Gap detection and deep research synthesis" },
];

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "style", label: "Style guide" },
  { id: "models", label: "Models" },
  { id: "help", label: "Help & shortcuts" },
];

const CLOSE_ANIMATION_MS = 180;

// ── Shell ────────────────────────────────────────────────────────────────────

export function SettingsPanel({
  onClose,
  onAutocompleteEnabledChange,
  onAutosaveEnabledChange,
  onLintEnabledChange,
  initialSection,
}: SettingsPanelProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? "style");
  const [exiting, setExiting] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    if (closeTimerRef.current) return;
    setExiting(true);
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, CLOSE_ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  return (
    <div
      className={`settings-overlay${exiting ? " settings-overlay--exiting" : ""}`}
      onClick={handleClose}
    >
      <div
        className={`settings-page${exiting ? " settings-page--exiting" : ""}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <nav className="settings-nav" aria-label="Settings sections">
          <button
            className="settings-back-btn"
            onClick={handleClose}
            title="Close settings (Esc)"
          >
            <ArrowLeft size={14} />
            <span>Back</span>
          </button>
          <ul className="settings-nav-list">
            {SECTIONS.map(({ id, label }) => (
              <li key={id} className={activeSection === id ? "active" : ""}>
                <button onClick={() => setActiveSection(id)}>{label}</button>
              </li>
            ))}
          </ul>
        </nav>
        <main className="settings-content">
          {activeSection === "style" && <StyleGuideSection />}
          {activeSection === "models" && (
            <ModelsSection
              onAutocompleteEnabledChange={onAutocompleteEnabledChange}
              onAutosaveEnabledChange={onAutosaveEnabledChange}
              onLintEnabledChange={onLintEnabledChange}
            />
          )}
          {activeSection === "help" && <HelpSection />}
        </main>
      </div>
    </div>
  );
}

// ── Style guide section ─────────────────────────────────────────────────────

function StyleGuideSection() {
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
      const res = await fetch("/api/style-guide", { method: "PATCH", body: content });
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

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Style guide</h2>
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
    </section>
  );
}

// ── Models section ──────────────────────────────────────────────────────────

interface ModelsSectionProps {
  onAutocompleteEnabledChange?: (enabled: boolean) => void;
  onAutosaveEnabledChange?: (enabled: boolean) => void;
  onLintEnabledChange?: (enabled: boolean) => void;
}

function ModelsSection({
  onAutocompleteEnabledChange,
  onAutosaveEnabledChange,
  onLintEnabledChange,
}: ModelsSectionProps) {
  const [models, setModels] = useState<string[]>([]);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({ default: "" });
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [lintEnabled, setLintEnabled] = useState(true);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("");
  const [initialOllamaBaseUrl, setInitialOllamaBaseUrl] = useState("");
  const [urlChangedNotice, setUrlChangedNotice] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: { models?: ModelConfig; features?: { autocomplete?: boolean; autosave?: boolean; lint?: boolean }; ollamaBaseUrl?: string }) => {
        if (data.models) setModelConfig(data.models);
        if (data.features?.autocomplete !== undefined) setAutocompleteEnabled(data.features.autocomplete);
        if (data.features?.autosave !== undefined) setAutosaveEnabled(data.features.autosave);
        if (data.features?.lint !== undefined) setLintEnabled(data.features.lint);
        const url = data.ollamaBaseUrl ?? "";
        setOllamaBaseUrl(url);
        setInitialOllamaBaseUrl(url);
      })
      .catch(() => {});

    fetch("/api/models")
      .then((r) => r.json())
      .then((data: { models?: string[] }) => setModels(data.models ?? []))
      .catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          models: modelConfig,
          features: { autocomplete: autocompleteEnabled, autosave: autosaveEnabled, lint: lintEnabled },
          ollamaBaseUrl,
        }),
      });
      if (res.ok) {
        onAutocompleteEnabledChange?.(autocompleteEnabled);
        onAutosaveEnabledChange?.(autosaveEnabled);
        onLintEnabledChange?.(lintEnabled);
        if (ollamaBaseUrl !== initialOllamaBaseUrl) {
          fetch("/api/models")
            .then((r) => r.json())
            .then((data: { models?: string[] }) => setModels(data.models ?? []))
            .catch(() => {});
          setUrlChangedNotice(true);
          setInitialOllamaBaseUrl(ollamaBaseUrl);
        }
        setStatus("saved");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }, [modelConfig, autocompleteEnabled, autosaveEnabled, lintEnabled, ollamaBaseUrl, initialOllamaBaseUrl, onAutocompleteEnabledChange, onAutosaveEnabledChange, onLintEnabledChange]);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Models</h2>
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
            onChange={(e) => { setAutosaveEnabled(e.target.checked); setStatus("idle"); }}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>
      <div className="model-config-row" style={{ marginBottom: 4 }}>
        <div className="model-config-label">
          <span className="model-config-name">Autocomplete</span>
          <span className="model-config-desc">Enable inline ghost-text suggestions while typing</span>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={autocompleteEnabled}
            onChange={(e) => { setAutocompleteEnabled(e.target.checked); setStatus("idle"); }}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>
      <div className="model-config-row" style={{ marginBottom: 8 }}>
        <div className="model-config-label">
          <span className="model-config-name">Linting</span>
          <span className="model-config-desc">Run AI writing quality checks after 5s of inactivity</span>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={lintEnabled}
            onChange={(e) => { setLintEnabled(e.target.checked); setStatus("idle"); }}
          />
          <span className="settings-toggle-track" />
        </label>
      </div>
      <div className="model-config-row" style={{ marginBottom: 8 }}>
        <div className="model-config-label">
          <span className="model-config-name">Ollama base URL</span>
          <span className="model-config-desc">
            Point Episteme at a different Ollama-compatible host. Leave blank for http://127.0.0.1:11434.
          </span>
        </div>
        <input
          className="model-config-input"
          type="text"
          value={ollamaBaseUrl}
          placeholder="http://127.0.0.1:11434"
          onChange={(e) => {
            setOllamaBaseUrl(e.target.value);
            setStatus("idle");
            setUrlChangedNotice(false);
          }}
        />
      </div>
      <datalist id="ollama-models">
        {models.map((m) => <option key={m} value={m} />)}
      </datalist>
      <div className="model-config-grid">
        {FEATURE_LABELS.map(({ key, label, desc }) => (
          <div key={key} className="model-config-row">
            <div className="model-config-label">
              <span className="model-config-name">{label}</span>
              <span className="model-config-desc">{desc}</span>
            </div>
            <input
              className="model-config-input"
              list="ollama-models"
              value={key === "default" ? modelConfig.default : (modelConfig[key] ?? "")}
              placeholder={key === "default" ? "Model name" : `Default (${modelConfig.default || "not set"})`}
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
                setStatus("idle");
              }}
            />
          </div>
        ))}
      </div>
      <div className="modal-footer">
        <div style={{ flex: 1 }} />
        {urlChangedNotice && (
          <span className="modal-status-ok">URL updated. Restart to switch the main chat agent.</span>
        )}
        {status === "saved" && !urlChangedNotice && <span className="modal-status-ok">Saved</span>}
        {status === "error" && <span className="modal-status-err">Save failed</span>}
        <button className="modal-btn-primary" onClick={handleSave} disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

// ── Help section ────────────────────────────────────────────────────────────

function HelpSection() {
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Help & shortcuts</h2>
      <table className="help-table">
        <tbody>
          {SHORTCUTS.map(({ key, desc }) => (
            <tr key={key} className="help-row">
              <td className="help-key"><kbd>{key}</kbd></td>
              <td className="help-desc">{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
