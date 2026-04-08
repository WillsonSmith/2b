import type { LLMProvider } from "./LLMProvider.ts";
import { LMStudioProvider } from "./LMStudioProvider.ts";
import { OllamaProvider } from "./OllamaProvider.ts";

/**
 * Constructs an LLMProvider from environment variables.
 *
 * Set PROVIDER=ollama to use Ollama, otherwise LMStudio is used.
 *
 * LMStudio env vars:
 *   LM_STUDIO_URL   WebSocket endpoint (default: ws://127.0.0.1:1234)
 *
 * Ollama env vars:
 *   OLLAMA_URL      HTTP endpoint  (default: http://127.0.0.1:11434)
 *   OLLAMA_NUM_CTX  Context window in tokens (omitted by default — Ollama scales automatically)
 */
export function createProvider(model: string): LLMProvider {
  const backend = (process.env.PROVIDER ?? "lmstudio").toLowerCase();

  if (backend === "ollama") {
    return new OllamaProvider(
      model,
      process.env.OLLAMA_URL ?? "http://127.0.0.1:11434",
      {
        toolCallingStrategy: "native",
        numCtx: process.env.OLLAMA_NUM_CTX
          ? Number(process.env.OLLAMA_NUM_CTX)
          : undefined,
        think: true,
      },
    );
  }

  return new LMStudioProvider(
    model,
    process.env.LM_STUDIO_URL ?? "ws://127.0.0.1:1234",
    { toolCallingStrategy: "native" },
  );
}

/**
 * Returns the default vision model base URL for the current provider.
 * Used by ImageVisionPlugin when VISION_BASE_URL is not set.
 */
export function defaultVisionBaseUrl(): string {
  const backend = (process.env.PROVIDER ?? "lmstudio").toLowerCase();
  return backend === "ollama"
    ? (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434")
    : "http://127.0.0.1:1234";
}

/**
 * Returns the default vision model name for the current provider.
 * Used by ImageVisionPlugin when VISION_MODEL is not set.
 */
export function defaultVisionModel(): string {
  const backend = (process.env.PROVIDER ?? "lmstudio").toLowerCase();
  return backend === "ollama" ? "gemma3:4b" : "google/gemma-3-4b";
}
