export type SettingsSection = "style" | "writing" | "models" | "permissions" | "help";

export interface ModelConfig {
  default: string;
  autocomplete?: string;
  research?: string;
  styleGuide?: string;
  export?: string;
  embedding?: string;
}

export type PermissionMode = "ask" | "session" | "never";

export interface ToolInfo {
  name: string;
  description: string;
  permission: "per_call" | "session";
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";
