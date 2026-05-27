import type { ModelConfig, SettingsSection } from "./types.ts";

export const CLOSE_ANIMATION_MS = 180;

export const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string }> = [
  { id: "style", label: "Style guide" },
  { id: "writing", label: "Writing aids" },
  { id: "models", label: "Models" },
  { id: "permissions", label: "Permissions" },
  { id: "help", label: "Help & shortcuts" },
];

export const SHORTCUTS: ReadonlyArray<{ key: string; desc: string }> = [
  { key: "⌘P", desc: "Open search & actions" },
  { key: "⌘S", desc: "Save file" },
  { key: "⌘F", desc: "Find in document" },
  { key: "⌘K", desc: "Insert link (in editor)" },
  { key: "⌘Z / ⌘⇧Z", desc: "Undo / Redo" },
  { key: "⌘B", desc: "Bold" },
  { key: "⌘I", desc: "Italic" },
  { key: "Tab", desc: "Accept ghost-text autocomplete" },
  { key: "Esc", desc: "Dismiss autocomplete" },
  { key: "Enter after /diagram: …", desc: "Generate Mermaid diagram" },
  { key: "Enter after /fill …", desc: "Insert AI fill block" },
  { key: "Shift+Enter in fill block", desc: "Generate AI fill content" },
  { key: "F1", desc: "Show keyboard shortcuts" },
  { key: "Paste/drop image", desc: "Insert image with AI alt text" },
  { key: "Hover code block", desc: "Explain code with AI" },
];

export const FEATURE_LABELS: ReadonlyArray<{ key: keyof ModelConfig; label: string; desc: string }> = [
  { key: "default", label: "Default", desc: "General chat and structural tasks" },
  { key: "autocomplete", label: "Autocomplete", desc: "Inline ghost-text suggestions" },
  { key: "research", label: "Research", desc: "Gap detection and deep research synthesis" },
  {
    key: "embedding",
    label: "Embedding",
    desc: "Semantic memory and search (must be an embedding model, e.g. nomic-embed-text)",
  },
];
