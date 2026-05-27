import { Button } from "../../primitives/Button.tsx";
import { Input } from "../../primitives/Input.tsx";
import { Text } from "../../primitives/Text.tsx";
import { SettingsRow } from "./SettingsRow.tsx";

interface ModelSelectStepProps {
  models: ReadonlyArray<string>;
  embeddingModels: ReadonlyArray<string>;
  defaultModel: string;
  embeddingModel: string;
  onDefaultChange: (value: string) => void;
  onEmbeddingChange: (value: string) => void;
  canEnable: boolean;
  submitting: boolean;
  error: string | null;
  onContinueWithoutAI: () => void;
  onEnableAI: () => void;
}

export function ModelSelectStep({
  models,
  embeddingModels,
  defaultModel,
  embeddingModel,
  onDefaultChange,
  onEmbeddingChange,
  canEnable,
  submitting,
  error,
  onContinueWithoutAI,
  onEnableAI,
}: ModelSelectStepProps) {
  return (
    <>
      <datalist id="onboarding-models">
        {models.map((m) => <option key={m} value={m} />)}
      </datalist>
      <datalist id="onboarding-embedding-models">
        {embeddingModels.map((m) => <option key={m} value={m} />)}
      </datalist>

      <div className="model-config-grid">
        <SettingsRow
          name="Default model"
          description="Used for chat, summarize, tone, diagrams, and more"
          control={
            <Input
              className="model-config-input"
              list="onboarding-models"
              value={defaultModel}
              placeholder="Pick a model"
              onChange={(e) => onDefaultChange(e.target.value)}
            />
          }
        />
        <SettingsRow
          name="Embedding model"
          description="Optional — for semantic memory and search"
          control={
            <Input
              className="model-config-input"
              list="onboarding-embedding-models"
              value={embeddingModel}
              placeholder="Default (nomic-embed-text)"
              onChange={(e) => onEmbeddingChange(e.target.value)}
            />
          }
        />
      </div>

      {error && (
        <Text tone="danger" variant="caption">
          {error}
        </Text>
      )}

      <div className="modal-footer">
        <Button variant="ghost" onClick={onContinueWithoutAI} disabled={submitting}>
          Continue without AI
        </Button>
        <div style={{ flex: 1 }} />
        <Button variant="solid" onClick={onEnableAI} disabled={!canEnable}>
          {submitting ? "Saving…" : "Enable AI"}
        </Button>
      </div>
    </>
  );
}
