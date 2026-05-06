import { LMStudioProvider } from "./LMStudioProvider.ts";
import { OllamaProvider } from "./OllamaProvider.ts";
import { ModelCapabilityProvider } from "./ModelCapabilityProvider.ts";

/**
 * Constructs an LLMProvider from environment variables.
 *
 * Always returns a ModelCapabilityProvider wrapping the concrete backend so
 * model-specific system prompt prefixes are applied transparently, and so
 * `setModel()` / `getModel()` are always available for hot-swapping.
 *
 * Set PROVIDER=ollama to use Ollama, otherwise LMStudio is used.
 *
 * Shared env vars:
 *   MODEL           Chat model name. Defaults are provider-specific (see defaultModel()).
 *
 * LMStudio env vars:
 *   LM_STUDIO_URL   WebSocket endpoint (default: ws://127.0.0.1:1234)
 *
 * Ollama env vars:
 *   OLLAMA_URL      HTTP endpoint  (default: http://127.0.0.1:11434)
 *   OLLAMA_NUM_CTX  Context window in tokens (omitted by default — Ollama scales automatically)
 *   OLLAMA_THINK    Enable reasoning (default: true). Set to "false" to disable, or
 *                   "high"/"medium"/"low" for models that accept a budget level.
 */
export function createProvider(model: string): ModelCapabilityProvider {
  const backend = (process.env.PROVIDER ?? "ollama").toLowerCase();

  if (backend === "ollama") {
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
          toolCallingStrategy: "native",
          numCtx,
          think,
        },
      ),
      model,
    );
  }

  return new ModelCapabilityProvider(
    new LMStudioProvider(
      model,
      process.env.LM_STUDIO_URL ?? "ws://127.0.0.1:1234",
      { toolCallingStrategy: "native" },
    ),
    model,
  );
}

/**
 * Returns the default vision model base URL for the current provider.
 * Used by ImageVisionPlugin when VISION_BASE_URL is not set.
 */
export function defaultVisionBaseUrl(): string {
  const backend = (process.env.PROVIDER ?? "ollama").toLowerCase();
  return backend === "ollama"
    ? (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434")
    : "http://127.0.0.1:1234";
}

/**
 * Returns the default vision model name for the current provider.
 * Used by ImageVisionPlugin when VISION_MODEL is not set.
 */
export function defaultVisionModel(): string {
  const backend = (process.env.PROVIDER ?? "ollama").toLowerCase();
  return backend === "ollama" ? "gemma3:4b" : "google/gemma-3-4b";
}

/**
 * Returns the default chat model name for the current provider.
 * Used by agent factories when MODEL env var is not set.
 */
export function defaultModel(): string {
  const backend = (process.env.PROVIDER ?? "ollama").toLowerCase();
  return backend === "ollama" ? "gemma4:26b" : "google/gemma-4-26b-a4b";
}
