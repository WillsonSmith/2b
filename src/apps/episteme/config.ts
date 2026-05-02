import { workspaceConfigPath } from "./paths.ts";
import { defaultModel } from "../../providers/llm/createProvider.ts";

/** Per-feature model assignments. Unset features fall back to `default`. */
export interface EpistemModelConfig {
  /** Primary model for general chat, brainstorming, and structural tasks. */
  default: string;
  /** Fast model for inline autocomplete suggestions. */
  autocomplete?: string;
  /** Powerful model for deep research synthesis and gap detection. */
  research?: string;
  /** Fast model for AI linting and style checks (runs on every save). */
  linting?: string;
  /** Model for multi-format export rendering. */
  export?: string;
}

export interface EpistemeFeatures {
  /** Whether inline ghost-text autocomplete is active. Default: false. */
  autocomplete?: boolean;
  /** Whether the editor autosaves after a pause in typing. Default: true. */
  autosave?: boolean;
}

export interface EpistemeConfig {
  models: EpistemModelConfig;
  features?: EpistemeFeatures;
}

function defaultConfig(): EpistemeConfig {
  return {
    models: {
      default: process.env["MODEL"] ?? defaultModel(),
    },
  };
}

export async function loadConfig(workspaceRoot: string): Promise<EpistemeConfig> {
  const configPath = workspaceConfigPath(workspaceRoot);
  try {
    const raw = await Bun.file(configPath).text();
    return JSON.parse(raw) as EpistemeConfig;
  } catch {
    return defaultConfig();
  }
}

export async function saveConfig(workspaceRoot: string, config: EpistemeConfig): Promise<void> {
  await Bun.write(workspaceConfigPath(workspaceRoot), JSON.stringify(config, null, 2));
}

/** Return the model name for a named feature, falling back to `config.models.default`. */
export function featureModel(config: EpistemeConfig, feature: keyof EpistemModelConfig): string {
  return config.models[feature] ?? config.models.default;
}
