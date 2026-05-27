import { Button } from "../../primitives/Button.tsx";
import { Input } from "../../primitives/Input.tsx";
import { Text } from "../../primitives/Text.tsx";
import { SettingsRow } from "./SettingsRow.tsx";

interface OllamaUnreachableStateProps {
  ollamaBaseUrl: string;
  onUrlChange: (value: string) => void;
  onRetry: () => void;
  onContinueWithoutAI: () => void;
  submitting: boolean;
}

export function OllamaUnreachableState({
  ollamaBaseUrl,
  onUrlChange,
  onRetry,
  onContinueWithoutAI,
  submitting,
}: OllamaUnreachableStateProps) {
  return (
    <>
      <Text tone="danger" variant="body" as="p">
        No Ollama models are reachable. Make sure Ollama is running, or point at a different host.
      </Text>
      <SettingsRow
        name="Ollama base URL"
        description="Leave blank for http://127.0.0.1:11434"
        control={
          <Input
            className="model-config-input"
            value={ollamaBaseUrl}
            placeholder="http://127.0.0.1:11434"
            onChange={(e) => onUrlChange(e.target.value)}
          />
        }
      />
      <div className="modal-footer">
        <Button variant="ghost" onClick={onRetry} disabled={submitting}>
          Retry
        </Button>
        <div style={{ flex: 1 }} />
        <Button variant="solid" onClick={onContinueWithoutAI} disabled={submitting}>
          Continue without AI
        </Button>
      </div>
    </>
  );
}
