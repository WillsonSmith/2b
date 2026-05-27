import { useCallback, useEffect, useState } from "react";
import { ModalShell } from "../../composites/ModalShell.tsx";
import { Text } from "../../primitives/Text.tsx";
import { ModelSelectStep } from "./ModelSelectStep.tsx";
import { OllamaUnreachableState } from "./OllamaUnreachableState.tsx";

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

  const canEnable = loadState === "ready" && defaultModel.trim().length > 0 && !submitting;

  return (
    <ModalShell
      open={open}
      title="Welcome to Episteme"
      width="min(560px, 92vw)"
      closeOnBackdrop={false}
      closeOnEsc={false}
    >
      <Text tone="muted" variant="body" as="p">
        Pick an Ollama model for AI features in this workspace, or continue with the editor only.
        You can change this later in Settings.
      </Text>

      {loadState === "loading" && (
        <Text tone="muted" variant="body" as="p">
          Looking for installed models…
        </Text>
      )}

      {loadState === "ollama-down" && (
        <OllamaUnreachableState
          ollamaBaseUrl={ollamaBaseUrl}
          onUrlChange={setOllamaBaseUrl}
          onRetry={() => void loadModels()}
          onContinueWithoutAI={() => void submit(false)}
          submitting={submitting}
        />
      )}

      {loadState === "ready" && (
        <ModelSelectStep
          models={models}
          embeddingModels={embeddingModels}
          defaultModel={defaultModel}
          embeddingModel={embeddingModel}
          onDefaultChange={setDefaultModel}
          onEmbeddingChange={setEmbeddingModel}
          canEnable={canEnable}
          submitting={submitting}
          error={error}
          onContinueWithoutAI={() => void submit(false)}
          onEnableAI={() => void submit(true)}
        />
      )}
    </ModalShell>
  );
}
