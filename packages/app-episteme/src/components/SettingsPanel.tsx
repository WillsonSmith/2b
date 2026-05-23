import { useState, useEffect, useCallback, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import type { WritingAidsConfig, WritingAidColors } from "../config.ts";
import { DEFAULT_HIGHLIGHT_COLORS, type HighlightColorKey } from "../features/themedColor.ts";

interface ModelConfig {
  default: string;
  autocomplete?: string;
  linting?: string;
  research?: string;
  export?: string;
  embedding?: string;
}

type PermissionMode = "ask" | "session" | "never";

interface ToolInfo {
  name: string;
  description: string;
  permission: "per_call" | "session";
}

type SettingsSection = "style" | "writing" | "models" | "permissions" | "help";

export type SettingsPanelSection = SettingsSection;

interface SettingsPanelProps {
  onClose: () => void;
  onAutocompleteEnabledChange?: (enabled: boolean) => void;
  onAutosaveEnabledChange?: (enabled: boolean) => void;
  onLintEnabledChange?: (enabled: boolean) => void;
  onWritingAidsChange?: (aids: WritingAidsConfig) => void;
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
  { key: "embedding", label: "Embedding", desc: "Semantic memory and search (must be an embedding model, e.g. nomic-embed-text)" },
];

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "style", label: "Style guide" },
  { id: "writing", label: "Writing aids" },
  { id: "models", label: "Models" },
  { id: "permissions", label: "Permissions" },
  { id: "help", label: "Help & shortcuts" },
];

const CLOSE_ANIMATION_MS = 180;

// ── Shell ────────────────────────────────────────────────────────────────────

export function SettingsPanel({
  onClose,
  onAutocompleteEnabledChange,
  onAutosaveEnabledChange,
  onLintEnabledChange,
  onWritingAidsChange,
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
          {activeSection === "writing" && (
            <WritingAidsSection onChange={onWritingAidsChange} />
          )}
          {activeSection === "models" && (
            <ModelsSection
              onAutocompleteEnabledChange={onAutocompleteEnabledChange}
              onAutosaveEnabledChange={onAutosaveEnabledChange}
              onLintEnabledChange={onLintEnabledChange}
            />
          )}
          {activeSection === "permissions" && <PermissionsSection />}
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
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
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

    fetch("/api/models?capability=embedding")
      .then((r) => r.json())
      .then((data: { models?: string[] }) => setEmbeddingModels(data.models ?? []))
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
          fetch("/api/models?capability=embedding")
            .then((r) => r.json())
            .then((data: { models?: string[] }) => setEmbeddingModels(data.models ?? []))
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
      <datalist id="ollama-embedding-models">
        {embeddingModels.map((m) => <option key={m} value={m} />)}
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
              list={key === "embedding" ? "ollama-embedding-models" : "ollama-models"}
              value={key === "default" ? modelConfig.default : (modelConfig[key] ?? "")}
              placeholder={
                key === "default"
                  ? "Model name"
                  : key === "embedding"
                    ? "Default (nomic-embed-text)"
                    : `Default (${modelConfig.default || "not set"})`
              }
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

// ── Permissions section ─────────────────────────────────────────────────────

function PermissionsSection() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [modes, setModes] = useState<Record<string, PermissionMode>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    fetch("/api/tools")
      .then((r) => r.json())
      .then((data: { tools?: ToolInfo[] }) => setTools(data.tools ?? []))
      .catch(() => {});
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: { permissions?: Record<string, PermissionMode> }) =>
        setModes(data.permissions ?? {}),
      )
      .catch(() => {});
  }, []);

  const setMode = useCallback((name: string, mode: PermissionMode) => {
    setModes((prev) => ({ ...prev, [name]: mode }));
    setStatus("idle");
  }, []);

  const handleSave = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: modes }),
      });
      setStatus(res.ok ? "saved" : "error");
    } catch {
      setStatus("error");
    }
  }, [modes]);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Permissions</h2>
      <p className="modal-desc">
        Decide which agent actions need your approval. "Ask" prompts every time,
        "Session" remembers your approval until the agent restarts, "Never ask"
        runs silently.
      </p>
      {tools.length === 0 ? (
        <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
          No permission-gated tools registered.
        </p>
      ) : (
        <div className="permissions-list">
          {tools.map((tool) => {
            const mode: PermissionMode = modes[tool.name] ?? "ask";
            return (
              <div key={tool.name} className="permission-row">
                <div className="permission-row-label">
                  <span className="permission-row-name">{tool.name}</span>
                  <span className="permission-row-desc">{tool.description}</span>
                </div>
                <div className="permission-row-controls" role="radiogroup" aria-label={`Approval mode for ${tool.name}`}>
                  {(["ask", "session", "never"] as const).map((opt) => (
                    <label key={opt} className={`permission-pill${mode === opt ? " active" : ""}`}>
                      <input
                        type="radio"
                        name={`perm-${tool.name}`}
                        checked={mode === opt}
                        onChange={() => setMode(tool.name, opt)}
                      />
                      <span>{opt === "ask" ? "Ask" : opt === "session" ? "Session" : "Never"}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="modal-footer">
        <div style={{ flex: 1 }} />
        {status === "saved" && <span className="modal-status-ok">Saved</span>}
        {status === "error" && <span className="modal-status-err">Save failed</span>}
        <button
          className="modal-btn-primary"
          onClick={handleSave}
          disabled={status === "saving" || tools.length === 0}
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}

// ── Writing aids section ────────────────────────────────────────────────────

interface WritingAidsSectionProps {
  onChange?: (aids: WritingAidsConfig) => void;
}

function WritingAidsSection({ onChange }: WritingAidsSectionProps) {
  const [aids, setAids] = useState<WritingAidsConfig>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: { features?: { writingAids?: WritingAidsConfig } }) => {
        setAids(data.features?.writingAids ?? {});
      })
      .catch(() => {});
  }, []);

  const update = useCallback(
    (patch: Partial<WritingAidsConfig>) => {
      setAids((prev) => ({ ...prev, ...patch }));
      setStatus("idle");
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setStatus("saving");
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ features: { writingAids: aids } }),
      });
      if (res.ok) {
        onChange?.(aids);
        setStatus("saved");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }, [aids, onChange]);

  const setColor = useCallback((key: HighlightColorKey, value: string) => {
    setAids((prev) => ({
      ...prev,
      colors: { ...(prev.colors ?? {}), [key]: value },
    }));
    setStatus("idle");
  }, []);
  const clearColor = useCallback((key: HighlightColorKey) => {
    setAids((prev) => {
      const nextColors: WritingAidColors = { ...(prev.colors ?? {}) };
      delete nextColors[key];
      return { ...prev, colors: nextColors };
    });
    setStatus("idle");
  }, []);

  const Toggle = ({
    name, desc, checked, onCheck, indent = false, colorKey,
  }: {
    name: string;
    desc: string;
    checked: boolean;
    onCheck: (v: boolean) => void;
    indent?: boolean;
    colorKey?: HighlightColorKey;
  }) => {
    const customized = colorKey ? aids.colors?.[colorKey] != null : false;
    const swatchValue = colorKey
      ? (aids.colors?.[colorKey] ?? DEFAULT_HIGHLIGHT_COLORS[colorKey])
      : undefined;
    return (
      <div className="model-config-row" style={{ marginBottom: 4, paddingLeft: indent ? 20 : 0 }}>
        <div className="model-config-label">
          <span className="model-config-name">{name}</span>
          <span className="model-config-desc">{desc}</span>
        </div>
        {colorKey && swatchValue && (
          <div className="color-swatch-group" title="Highlight color (auto-adjusts for theme)">
            <input
              type="color"
              className="color-swatch"
              value={swatchValue}
              onChange={(e) => setColor(colorKey, e.target.value)}
            />
            {customized && (
              <button
                type="button"
                className="color-swatch-reset"
                title="Reset to default"
                onClick={() => clearColor(colorKey)}
              >
                ↺
              </button>
            )}
          </div>
        )}
        <label className="settings-toggle">
          <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} />
          <span className="settings-toggle-track" />
        </label>
      </div>
    );
  };

  const posOn = aids.posHighlight ?? false;
  const focusOn = aids.focusMode ?? false;
  const styleOn = aids.styleCheck ?? false;

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Writing aids</h2>
      <p className="modal-desc">
        iA Writer-style visual layers. All run locally — no AI calls.
      </p>

      <h3 className="settings-subhead">Syntax highlighting</h3>
      <Toggle
        name="Parts of speech"
        desc="Color nouns, verbs, adjectives, and adverbs."
        checked={posOn}
        onCheck={(v) => update({ posHighlight: v })}
      />
      {posOn && (
        <>
          <Toggle name="Nouns" desc="" checked={aids.posNoun ?? true}
            onCheck={(v) => update({ posNoun: v })} indent colorKey="posNoun" />
          <Toggle name="Verbs" desc="" checked={aids.posVerb ?? true}
            onCheck={(v) => update({ posVerb: v })} indent colorKey="posVerb" />
          <Toggle name="Adjectives" desc="" checked={aids.posAdjective ?? true}
            onCheck={(v) => update({ posAdjective: v })} indent colorKey="posAdjective" />
          <Toggle name="Adverbs" desc="" checked={aids.posAdverb ?? true}
            onCheck={(v) => update({ posAdverb: v })} indent colorKey="posAdverb" />
        </>
      )}
      <Toggle
        name="Punctuation"
        desc="Tint commas, periods, dashes, and quotes."
        checked={aids.punctuationHighlight ?? false}
        onCheck={(v) => update({ punctuationHighlight: v })}
        colorKey="punct"
      />

      <h3 className="settings-subhead">Focus mode</h3>
      <Toggle
        name="Dim inactive text"
        desc="Fade everything outside the active sentence or paragraph."
        checked={focusOn}
        onCheck={(v) => update({ focusMode: v })}
      />
      {focusOn && (
        <div className="model-config-row" style={{ marginBottom: 4, paddingLeft: 20 }}>
          <div className="model-config-label">
            <span className="model-config-name">Focus level</span>
            <span className="model-config-desc">Keep just the sentence or the whole paragraph visible.</span>
          </div>
          <div className="permission-row-controls" role="radiogroup" aria-label="Focus level">
            {(["sentence", "paragraph"] as const).map((opt) => (
              <label key={opt} className={`permission-pill${(aids.focusLevel ?? "sentence") === opt ? " active" : ""}`}>
                <input
                  type="radio"
                  name="focus-level"
                  checked={(aids.focusLevel ?? "sentence") === opt}
                  onChange={() => update({ focusLevel: opt })}
                />
                <span>{opt === "sentence" ? "Sentence" : "Paragraph"}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <h3 className="settings-subhead">Style checks</h3>
      <Toggle
        name="Mark style issues"
        desc="Underline fillers, clichés, and redundancies as you type."
        checked={styleOn}
        onCheck={(v) => update({ styleCheck: v })}
      />
      {styleOn && (
        <>
          <Toggle name="Fillers" desc='Words like "very", "just", "really".'
            checked={aids.styleFiller ?? true}
            onCheck={(v) => update({ styleFiller: v })} indent colorKey="styleFiller" />
          <Toggle name="Clichés" desc='Phrases like "at the end of the day".'
            checked={aids.styleCliche ?? true}
            onCheck={(v) => update({ styleCliche: v })} indent colorKey="styleCliche" />
          <Toggle name="Redundancies" desc='Pairs like "ATM machine", "free gift".'
            checked={aids.styleRedundancy ?? true}
            onCheck={(v) => update({ styleRedundancy: v })} indent colorKey="styleRedundancy" />
          <Toggle name="Strikethrough" desc="Cross out matches instead of underlining them."
            checked={aids.styleStrikethrough ?? false}
            onCheck={(v) => update({ styleStrikethrough: v })} indent />
          <Toggle name="Tint text" desc="Recolor the matched word itself, not just the line."
            checked={aids.styleTintText ?? false}
            onCheck={(v) => update({ styleTintText: v })} indent />
        </>
      )}

      <div className="modal-footer">
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
