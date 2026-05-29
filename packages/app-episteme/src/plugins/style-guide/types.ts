/** A single style-guide section. The body is what gets injected into the prompt. */
export interface StyleSection {
  /** Slug, also the `<id>.md` filename stem. Stable across renames. */
  id: string;
  /** Human-readable, shown in the UI list. Lives in the manifest, not the file. */
  title: string;
  /** Markdown injected into the system prompt. Stored verbatim in `<id>.md`. */
  body: string;
  enabled: boolean;
  /** Ascending; the manifest is the source of truth. */
  order: number;
}

/** Canonical record of section order + enabled state. Bodies live in `<id>.md`. */
export interface StyleGuideManifest {
  version: 1;
  sections: Array<Pick<StyleSection, "id" | "title" | "enabled" | "order">>;
}

/** Budget surface for the settings meter. `used` may exceed `cap`. */
export interface StyleBudget {
  used: number;
  cap: number;
  droppedSectionIds: string[];
}
