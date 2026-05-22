import { OllamaProvider } from "./OllamaProvider.ts";
import { ModelCapabilityProvider } from "./ModelCapabilityProvider.ts";

/**
 * Constructs an LLMProvider from environment variables.
 *
 * Always returns a ModelCapabilityProvider wrapping OllamaProvider so
 * model-specific system prompt prefixes are applied transparently, and so
 * `setModel()` / `getModel()` are always available for hot-swapping.
 *
 * Env vars:
 *   MODEL           Chat model name (default: see defaultModel())
 *   OLLAMA_URL      HTTP endpoint  (default: http://127.0.0.1:11434)
 *   OLLAMA_NUM_CTX  Context window in tokens (omitted by default — Ollama scales automatically)
 *   OLLAMA_THINK    Enable reasoning (default: true). Set to "false" to disable, or
 *                   "high"/"medium"/"low" for models that accept a budget level.
 *
 * @param model           Chat model name.
 * @param embeddingModel  Optional override for the embedding model used by
 *                        getEmbedding(). Defaults to OllamaProvider's built-in
 *                        default ("nomic-embed-text") when omitted.
 */
export function createProvider(model: string, embeddingModel?: string): ModelCapabilityProvider {
  const rawNumCtx = process.env.OLLAMA_NUM_CTX;
  let numCtx: number | undefined;
  if (rawNumCtx !== undefined) {
    numCtx = parseInt(rawNumCtx, 10);
    if (isNaN(numCtx)) {
      throw new Error(
        `OLLAMA_NUM_CTX is not a valid integer: "${rawNumCtx}"`,
      );
    }
  }

  const rawThink = process.env.OLLAMA_THINK;
  let think: boolean | "high" | "medium" | "low" = true;
  if (rawThink !== undefined) {
    if (rawThink === "false") {
      think = false;
    } else if (
      rawThink === "high" ||
      rawThink === "medium" ||
      rawThink === "low"
    ) {
      think = rawThink;
    } else if (rawThink !== "true") {
      throw new Error(
        `OLLAMA_THINK must be "true", "false", "high", "medium", or "low" — got "${rawThink}"`,
      );
    }
  }

  return new ModelCapabilityProvider(
    new OllamaProvider(
      model,
      process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
      {
        numCtx,
        think,
        embeddingModel,
      },
    ),
    model,
  );
}

/**
 * Returns the default vision model base URL.
 * Used by ImageVisionPlugin when VISION_BASE_URL is not set.
 */
export function defaultVisionBaseUrl(): string {
  return process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
}

/**
 * Returns the default vision model name.
 * Used by ImageVisionPlugin when VISION_MODEL is not set.
 */
export function defaultVisionModel(): string {
  return "gemma3:4b";
}

/**
 * Returns the default chat model name.
 * Used by agent factories when MODEL env var is not set.
 */
export function defaultModel(): string {
  return "gemma4:26b";
}
