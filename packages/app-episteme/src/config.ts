import { workspaceConfigPath } from "./paths.ts";
import { defaultModel } from "@2b/framework/providers/llm/createProvider.ts";

/** Per-feature model assignments. Unset features fall back to `default`. */
export interface EpistemModelConfig {
  /** Primary model for general chat, brainstorming, and structural tasks. */
  default: string;
  /** Fast model for inline autocomplete suggestions. */
  autocomplete?: string;
  /** Powerful model for deep research synthesis and gap detection. */
  research?: string;
  /** Model for generating style-guide sections from a description. */
  styleGuide?: string;
  /** Model for multi-format export rendering. */
  export?: string;
  /**
   * Embedding model for semantic memory and search. Unlike the other fields
   * this is NOT a chat model — it must be an embedding-capable model
   * (e.g. "nomic-embed-text"). When unset the framework default is used.
   */
  embedding?: string;
}

/**
 * Per-tool permission mode for agent actions.
 *   "ask"     — surface an approval dialog for every invocation
 *   "session" — approve once, remember for the rest of the session
 *   "never"   — auto-approve silently (no dialog)
 */
export type EpistemePermissionMode = "ask" | "session" | "never";

export interface EpistemeFeatures {
  /** Whether inline ghost-text autocomplete is active. Default: false. */
  autocomplete?: boolean;
  /** Whether the editor autosaves after a pause in typing. Default: true. */
  autosave?: boolean;
  /** Writing-aid visualization layers (iA Writer-style). All default off. */
  writingAids?: WritingAidsConfig;
}

export interface WritingAidsConfig {
  /** Color parts of speech (noun/verb/adjective/adverb). */
  posHighlight?: boolean;
  posNoun?: boolean;
  posVerb?: boolean;
  posAdjective?: boolean;
  posAdverb?: boolean;
  /** Color punctuation characters. */
  punctuationHighlight?: boolean;
  /** Dim everything outside the active sentence/paragraph. */
  focusMode?: boolean;
  focusLevel?: "sentence" | "paragraph";
  /** Underline fillers, clichés, and redundancies. */
  styleCheck?: boolean;
  styleFiller?: boolean;
  styleCliche?: boolean;
  styleRedundancy?: boolean;
  /** Render style-check matches as strikethrough instead of underline. */
  styleStrikethrough?: boolean;
  /** Tint the matched word itself with its category color. */
  styleTintText?: boolean;
  /** User-picked highlight colors (hex). Lightness is auto-adjusted per theme. */
  colors?: WritingAidColors;
}

export interface WritingAidColors {
  posNoun?: string;
  posVerb?: string;
  posAdjective?: string;
  posAdverb?: string;
  punct?: string;
  styleFiller?: string;
  styleCliche?: string;
  styleRedundancy?: string;
}

/** Tunables for ContradictionPlugin's background scan. All fields optional. */
export interface ContradictionScanConfig {
  /** Memories per LLM batch. Default: 15. */
  window?: number;
  /** Step between batches. Lower = more overlap (catches pairs across boundaries). Default: ceil(window/2) = 8. */
  stride?: number;
  /** Background scan cadence in ms. Default: 1_800_000 (30 min). */
  intervalMs?: number;
}

export interface EpistemeConfig {
  models: EpistemModelConfig;
  features?: EpistemeFeatures;
  contradictionScan?: ContradictionScanConfig;
  /** Override the Ollama HTTP endpoint. When set, replaces process.env.OLLAMA_URL. */
  ollamaBaseUrl?: string;
  /**
   * Whether AI features are active for this workspace. `undefined` is treated
   * as `true` for back-compat with workspaces created before this field existed.
   * Set to `false` to run Episteme as a plain Markdown editor.
   */
  aiEnabled?: boolean;
  /**
   * Per-tool approval mode. Tools not listed here fall back to whatever the
   * tool's `permission` annotation declares (a tool declared `"none"` is
   * never gated; a tool declared `"per_call"`/`"session"` defaults to "ask").
   */
  permissions?: Record<string, EpistemePermissionMode>;
}

function defaultConfig(): EpistemeConfig {
  return {
    models: {
      default: process.env["MODEL"] ?? defaultModel(),
    },
  };
}

export interface LoadedConfig {
  config: EpistemeConfig;
  /** True when no config file existed on disk — the workspace is brand new. */
  isFirstLaunch: boolean;
}

export async function loadConfig(workspaceRoot: string): Promise<LoadedConfig> {
  const configPath = workspaceConfigPath(workspaceRoot);
  try {
    const raw = await Bun.file(configPath).text();
    return { config: JSON.parse(raw) as EpistemeConfig, isFirstLaunch: false };
  } catch {
    return { config: defaultConfig(), isFirstLaunch: true };
  }
}

export async function saveConfig(workspaceRoot: string, config: EpistemeConfig): Promise<void> {
  await Bun.write(workspaceConfigPath(workspaceRoot), JSON.stringify(config, null, 2));
}

/** Return the model name for a named feature, falling back to `config.models.default`. */
export function featureModel(config: EpistemeConfig, feature: keyof EpistemModelConfig): string {
  return config.models[feature] ?? config.models.default;
}
