import { useCallback, useEffect, useState } from "react";

interface OnboardingModalProps {
  open: boolean;
  onComplete: (result: { aiEnabled: boolean }) => void;
}

type LoadState = "loading" | "ready" | "ollama-down";

export function OnboardingModal({ open, onComplete }: OnboardingModalProps) {
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [models, setModels] = useState<string[]>([]);
  const [embeddingModels, setEmbeddingModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    setLoadState("loading");
    setError(null);
    try {
      const [chatRes, embedRes] = await Promise.all([
        fetch("/api/models"),
        fetch("/api/models?capability=embedding"),
      ]);
      const chatData = (await chatRes.json()) as { models?: string[] };
      const embedData = (await embedRes.json()) as { models?: string[] };
      const chatList = chatData.models ?? [];
      setModels(chatList);
      setEmbeddingModels(embedData.models ?? []);
      setLoadState(chatList.length > 0 ? "ready" : "ollama-down");
      if (chatList.length > 0 && !defaultModel) {
        setDefaultModel(chatList[0]!);
      }
    } catch {
      setLoadState("ollama-down");
    }
  }, [defaultModel]);

  useEffect(() => {
    if (open) void loadModels();
  }, [open, loadModels]);

  const submit = useCallback(
    async (aiEnabled: boolean) => {
      setSubmitting(true);
      setError(null);
      try {
        const body = aiEnabled
          ? {
              aiEnabled: true,
              models: {
                default: defaultModel.trim(),
                ...(embeddingModel.trim() ? { embedding: embeddingModel.trim() } : {}),
              },
              ...(ollamaBaseUrl.trim() ? { ollamaBaseUrl: ollamaBaseUrl.trim() } : {}),
            }
          : { aiEnabled: false };
        const res = await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setError(data.error ?? "Failed to save settings.");
          setSubmitting(false);
          return;
        }
        onComplete({ aiEnabled });
      } catch {
        setError("Network error.");
        setSubmitting(false);
      }
    },
    [defaultModel, embeddingModel, ollamaBaseUrl, onComplete],
  );

  if (!open) return null;

  const canEnable = loadState === "ready" && defaultModel.trim().length > 0 && !submitting;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: "min(560px, 92vw)" }}>
        <div className="modal-header">
          <span className="modal-title">Welcome to Episteme</span>
        </div>
        <p className="modal-desc">
          Pick an Ollama model for AI features in this workspace, or continue with the editor only.
          You can change this later in Settings.
        </p>

        {loadState === "loading" && (
          <p className="modal-desc">Looking for installed models…</p>
        )}

        {loadState === "ollama-down" && (
          <>
            <p className="modal-desc" style={{ color: "var(--red)" }}>
              No Ollama models are reachable. Make sure Ollama is running, or point at a different host.
            </p>
            <div className="model-config-row">
              <div className="model-config-label">
                <span className="model-config-name">Ollama base URL</span>
                <span className="model-config-desc">Leave blank for http://127.0.0.1:11434</span>
              </div>
              <input
                className="model-config-input"
                type="text"
                value={ollamaBaseUrl}
                placeholder="http://127.0.0.1:11434"
                onChange={(e) => setOllamaBaseUrl(e.target.value)}
              />
            </div>
            <div className="modal-footer">
              <button
                className="modal-btn-ghost"
                onClick={() => void loadModels()}
                disabled={submitting}
              >
                Retry
              </button>
              <div style={{ flex: 1 }} />
              <button
                className="modal-btn-primary"
                onClick={() => void submit(false)}
                disabled={submitting}
              >
                Continue without AI
              </button>
            </div>
          </>
        )}

        {loadState === "ready" && (
          <>
            <datalist id="onboarding-models">
              {models.map((m) => <option key={m} value={m} />)}
            </datalist>
            <datalist id="onboarding-embedding-models">
              {embeddingModels.map((m) => <option key={m} value={m} />)}
            </datalist>
            <div className="model-config-grid">
              <div className="model-config-row">
                <div className="model-config-label">
                  <span className="model-config-name">Default model</span>
                  <span className="model-config-desc">Used for chat, summarize, tone, diagrams, and more</span>
                </div>
                <input
                  className="model-config-input"
                  list="onboarding-models"
                  value={defaultModel}
                  placeholder="Pick a model"
                  onChange={(e) => setDefaultModel(e.target.value)}
                />
              </div>
              <div className="model-config-row">
                <div className="model-config-label">
                  <span className="model-config-name">Embedding model</span>
                  <span className="model-config-desc">Optional — for semantic memory and search</span>
                </div>
                <input
                  className="model-config-input"
                  list="onboarding-embedding-models"
                  value={embeddingModel}
                  placeholder="Default (nomic-embed-text)"
                  onChange={(e) => setEmbeddingModel(e.target.value)}
                />
              </div>
            </div>
            {error && <p className="modal-status-err" style={{ fontSize: 12 }}>{error}</p>}
            <div className="modal-footer">
              <button
                className="modal-btn-ghost"
                onClick={() => void submit(false)}
                disabled={submitting}
              >
                Continue without AI
              </button>
              <div style={{ flex: 1 }} />
              <button
                className="modal-btn-primary"
                onClick={() => void submit(true)}
                disabled={!canEnable}
              >
                {submitting ? "Saving…" : "Enable AI"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
