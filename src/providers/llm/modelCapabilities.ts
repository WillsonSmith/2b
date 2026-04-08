/**
 * Model capability registry.
 *
 * Maps model name patterns to capabilities that apply regardless of which
 * backend (Ollama, LMStudio, etc.) is serving the model.
 *
 * To add a capability for a new model, append an entry to REGISTRY.
 */

export interface ModelCapabilities {
  /**
   * A string to prepend to the system prompt on every `chat()` call.
   * Used for models that require special activation tokens (e.g. `<|think|>`
   * to enable reasoning in gemma4).
   */
  systemPromptPrefix?: string;
}

const REGISTRY: Array<{ pattern: RegExp; capabilities: ModelCapabilities }> = [
  {
    // gemma4 requires <|think|> in the system prompt to activate reasoning,
    // separate from the provider-level `think` parameter.
    pattern: /gemma[-_]?4/i,
    capabilities: { systemPromptPrefix: "<|think|>" },
  },
];

/**
 * Returns the merged capabilities for a given model name.
 * Multiple registry entries can match; later entries override earlier ones.
 */
export function getModelCapabilities(model: string): ModelCapabilities {
  const result: ModelCapabilities = {};
  for (const { pattern, capabilities } of REGISTRY) {
    if (pattern.test(model)) Object.assign(result, capabilities);
  }
  return result;
}
