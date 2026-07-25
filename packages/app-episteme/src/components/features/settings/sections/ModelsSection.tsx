import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../primitives/Button.tsx";
import { Checkbox } from "../../../primitives/Checkbox.tsx";
import { Input } from "../../../primitives/Input.tsx";
import { Text } from "../../../primitives/Text.tsx";
import { SettingsRow } from "../SettingsRow.tsx";
import { ToggleSwitch } from "../ToggleSwitch.tsx";
import { FEATURE_LABELS } from "../constants.ts";
import type { ModelConfig, SaveStatus } from "../types.ts";

interface ModelsSectionProps {
  onAutocompleteEnabledChange?: (enabled: boolean) => void;
  onAutosaveEnabledChange?: (enabled: boolean) => void;
}

export function ModelsSection({
  onAutocompleteEnabledChange,
  onAutosaveEnabledChange,
}: ModelsSectionProps) {
  const [models, setModels] = useState<string[]>([]);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({ default: "" });
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [initialAiEnabled, setInitialAiEnabled] = useState(true);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("");
  const [ollamaOverrideEnabled, setOllamaOverrideEnabled] = useState(false);
  const [initialOllamaBaseUrl, setInitialOllamaBaseUrl] = useState("");
  const [urlChangedNotice, setUrlChangedNotice] = useState(false);
  const [restartRequiredNotice, setRestartRequiredNotice] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data: {
        models?: ModelConfig;
        features?: { autocomplete?: boolean; autosave?: boolean };
        ollamaBaseUrl?: string;
        aiEnabled?: boolean;
      }) => {
        if (data.models) setModelConfig(data.models);
        if (data.features?.autocomplete !== undefined) setAutocompleteEnabled(data.features.autocomplete);
        if (data.features?.autosave !== undefined) setAutosaveEnabled(data.features.autosave);
        const url = data.ollamaBaseUrl ?? "";
        setOllamaBaseUrl(url);
        setOllamaOverrideEnabled(url.trim() !== "");
        setInitialOllamaBaseUrl(url);
        const enabled = data.aiEnabled !== false;
        setAiEnabled(enabled);
        setInitialAiEnabled(enabled);
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
    if (aiEnabled && !modelConfig.default?.trim()) {
      setValidationError("Pick a default model before enabling AI.");
      setStatus("idle");
      return;
    }
    setValidationError(null);
    setStatus("saving");
    const effectiveOllamaBaseUrl = ollamaOverrideEnabled ? ollamaBaseUrl : "";
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          models: modelConfig,
          features: { autocomplete: autocompleteEnabled, autosave: autosaveEnabled },
          ollamaBaseUrl: effectiveOllamaBaseUrl,
          aiEnabled,
        }),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { restartRequired?: boolean };
        onAutocompleteEnabledChange?.(autocompleteEnabled);
        onAutosaveEnabledChange?.(autosaveEnabled);
        if (effectiveOllamaBaseUrl !== initialOllamaBaseUrl) {
          fetch("/api/models")
            .then((r) => r.json())
            .then((d: { models?: string[] }) => setModels(d.models ?? []))
            .catch(() => {});
          fetch("/api/models?capability=embedding")
            .then((r) => r.json())
            .then((d: { models?: string[] }) => setEmbeddingModels(d.models ?? []))
            .catch(() => {});
          setUrlChangedNotice(true);
          setInitialOllamaBaseUrl(effectiveOllamaBaseUrl);
        }
        if (data.restartRequired || aiEnabled !== initialAiEnabled) {
          setRestartRequiredNotice(true);
          setInitialAiEnabled(aiEnabled);
        }
        setStatus("saved");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }, [modelConfig, autocompleteEnabled, autosaveEnabled, ollamaBaseUrl, ollamaOverrideEnabled, initialOllamaBaseUrl, aiEnabled, initialAiEnabled, onAutocompleteEnabledChange, onAutosaveEnabledChange]);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Models</h2>
      <p className="modal-desc">
        Assign different Ollama models per feature. Leave a feature on "Default" to inherit the default model.
      </p>
      <SettingsRow
        name="Enable AI for this workspace"
        description="Turn off to use Episteme as a plain Markdown editor. Changes take effect after restart."
        control={
          <ToggleSwitch
            checked={aiEnabled}
            ariaLabel="Enable AI"
            onChange={(v) => {
              setAiEnabled(v);
              setStatus("idle");
              setValidationError(null);
              setRestartRequiredNotice(false);
            }}
          />
        }
      />
      <SettingsRow
        name="Autosave"
        description="Automatically save after 2 seconds of inactivity"
        control={
          <ToggleSwitch
            checked={autosaveEnabled}
            ariaLabel="Autosave"
            onChange={(v) => { setAutosaveEnabled(v); setStatus("idle"); }}
          />
        }
      />
      <SettingsRow
        name="Autocomplete"
        description="Enable inline ghost-text suggestions while typing"
        control={
          <ToggleSwitch
            checked={autocompleteEnabled}
            ariaLabel="Autocomplete"
            onChange={(v) => { setAutocompleteEnabled(v); setStatus("idle"); }}
          />
        }
      />
      <SettingsRow
        name="Ollama base URL"
        description="Point Episteme at a different Ollama-compatible host. When unchecked, Episteme uses the default http://127.0.0.1:11434."
        style={{ marginBottom: 8 }}
        control={
          <div className="model-config-url-control">
            <Checkbox
              checked={ollamaOverrideEnabled}
              label="Use override"
              onChange={(v) => {
                setOllamaOverrideEnabled(v);
                setStatus("idle");
                setUrlChangedNotice(false);
              }}
            />
            <Input
              className="model-config-input"
              value={ollamaBaseUrl}
              placeholder="http://127.0.0.1:11434"
              disabled={!ollamaOverrideEnabled}
              onChange={(e) => {
                setOllamaBaseUrl(e.target.value);
                setStatus("idle");
                setUrlChangedNotice(false);
              }}
            />
          </div>
        }
      />
      <datalist id="ollama-models">
        {models.map((m) => <option key={m} value={m} />)}
      </datalist>
      <datalist id="ollama-embedding-models">
        {embeddingModels.map((m) => <option key={m} value={m} />)}
      </datalist>
      <div className="model-config-grid">
        {FEATURE_LABELS.map(({ key, label, desc }) => (
          <SettingsRow
            key={key}
            name={label}
            description={desc}
            control={
              <Input
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
            }
          />
        ))}
      </div>
      <div className="modal-footer">
        <div style={{ flex: 1 }} />
        {validationError && <Text tone="danger" variant="caption">{validationError}</Text>}
        {!validationError && restartRequiredNotice && (
          <Text tone="success" variant="caption">AI mode changed — restart Episteme to apply.</Text>
        )}
        {!validationError && !restartRequiredNotice && urlChangedNotice && (
          <Text tone="success" variant="caption">URL updated. Restart to switch the main chat agent.</Text>
        )}
        {!validationError && status === "saved" && !urlChangedNotice && !restartRequiredNotice && (
          <Text tone="success" variant="caption">Saved</Text>
        )}
        {status === "error" && <Text tone="danger" variant="caption">Save failed</Text>}
        <Button variant="solid" onClick={handleSave} disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </Button>
      </div>
    </section>
  );
}
