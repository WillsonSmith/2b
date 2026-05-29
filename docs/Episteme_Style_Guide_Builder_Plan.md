# Episteme Style Guide Builder — v1 Plan

Replace the single-textarea style guide with a section-based builder, and make the plugin always-loaded instead of gated behind explicit activation.

The current state (commit at planning time): `StyleGuidePlugin` reads `.episteme/style-guide.md` and injects it as a prompt fragment — but only after the user has saved at least once, because the server route gates the plugin behind `bundle.activatePlugin("StyleGuide")`. The Settings UI is a single textarea with Save/Clear. There are no presets, no structure, no library, no migration story.

---

## 1. Goal & scope

**Ship in v1:**
- Sections-based authoring: each section has a title and a body, can be enabled/disabled and reordered.
- Plugin always active. No activation gate. `getInactiveHint` removed.
- Hybrid storage: `.episteme/style-guide/<slug>.md` for section bodies + `.episteme/style-guide/manifest.json` for order/enabled state.
- Two-column Settings UI (list + editor), drag-to-reorder, 4,000-char budget meter, "Import from library" entry point.
- Shipped library of 5–8 starter sections (mix of generic voice + specialty).
- Auto-migrate any existing `.episteme/style-guide.md` into a single "Default" section on first run.

**Explicitly deferred to v2+:**
- Experts (named bundles of sections; many-to-many to sections).
- Always-visible role/expert switcher (status bar + command palette).
- "When to apply" per-section hints.
- LLM tools to read/write the style guide. v1 ships zero style-guide tools — agent just consumes the prompt fragment.
- Per-document or per-folder active expert.

**Out of scope, possibly forever:**
- Cross-workspace sharing of sections (export/import as a manual file copy is fine).
- Conflict detection between sections.

---

## 2. Decisions log

| Decision | Choice | Why |
| --- | --- | --- |
| v1 grouping model | Sections only; experts deferred | Prove the section model before adding the layer; keeps v1 small. |
| Default empty-state UX | Single textarea, "split into sections" is opt-in | Doesn't force structure on users who just want one block. |
| Switcher location | None in v1 | With no experts to switch between, the switcher has nothing to do. |
| Storage format | Hybrid `.md` files + `manifest.json` | Bodies stay user-editable in any editor; manifest holds structural data. |
| Section schema | `{ id, title, body, enabled, order }` | No "when to apply" hint, no human-only description. Simplest viable. |
| Settings layout | Two-column (list + editor) | Scales to many sections, familiar pattern. |
| Master on/off | None | Single source of truth = per-section enables. Header shows "Active · N sections" pill instead. |
| Budget cap | 4,000 chars, drop trailing sections when over | ~2× current; meter always visible; whole-section drops avoid mid-text cuts. |
| LLM tool surface | None | Smallest tool surface; agent just reads the assembled prompt fragment. |
| Starter library | 5–8 mixed (voice basics + specialty) | Good onboarding without authoring a sprawl. |
| Migration | Auto-import legacy file as single "Default" section | Zero user action; nothing lost. |
| Plugin activation | Unconditionally active | Resolves the "not automatically loaded" complaint. |

---

## 3. Data model

```ts
// packages/app-episteme/src/plugins/style-guide/types.ts

export interface StyleSection {
  id: string;          // slug, also the .md filename stem
  title: string;       // human-readable, shown in UI list
  body: string;        // injected into system prompt
  enabled: boolean;
  order: number;       // ascending; manifest is the source of truth
}

export interface StyleGuideManifest {
  version: 1;
  sections: Array<Pick<StyleSection, "id" | "title" | "enabled" | "order">>;
}
```

### Storage layout

```
.episteme/style-guide/
├─ manifest.json
├─ default.md
├─ concise-voice.md
├─ british-english.md
└─ …
```

- `manifest.json` is canonical for order and enabled state.
- Each section's `body` lives in `<id>.md` — no frontmatter, just the markdown. Title lives in the manifest, not in the file, to keep section bodies copy-pasteable.
- IDs are stable slugs generated from the title at create time. Rename does not change the ID (avoids file renames and prompt churn).

---

## 4. Plugin changes (`StyleGuidePlugin`)

### Behavior
- `onInit`: read `manifest.json`; for each entry, read `<id>.md`. Populate in-memory section list.
- `getSystemPromptFragment`: concatenate enabled sections **in `order`**, with a `## Style Guide` header. Apply 4,000-char cap by dropping whole sections from the bottom (highest `order` first). Return empty string if no enabled content.
- `reload()`: re-read manifest + all section files. Called from settings PATCH handlers after a write.

### Public API for the server layer
```ts
class StyleGuidePlugin {
  // existing
  name = "StyleGuide";
  onInit(): Promise<void>;
  getSystemPromptFragment(): Promise<string>;

  // new
  listSections(): StyleSection[];
  createSection(input: { title: string; body: string }): Promise<StyleSection>;
  updateSection(id: string, patch: Partial<Pick<StyleSection, "title" | "body" | "enabled">>): Promise<StyleSection>;
  deleteSection(id: string): Promise<void>;
  reorder(orderedIds: string[]): Promise<void>;
  importFromLibrary(librarySlug: string): Promise<StyleSection>;

  // budget surface (so the UI can show the meter)
  getBudget(): { used: number; cap: number; droppedSectionIds: string[] };
}
```

### Removed
- `get_style_guide` and `set_style_guide` tools (per decision: zero tool surface).
- `getInactiveHint()` — dead once plugin is always active.
- `currentContent` getter — replaced by `listSections()`.
- `save(content)` — replaced by `createSection` / `updateSection`.

### Always-active wiring
- Remove the `bundle.activatePlugin("StyleGuide")` call from the PATCH handler.
- StyleGuide should be in the bundle's `activePlugins` from boot.
- Confirm in `packages/app-episteme/src/server/index.ts` startup that the plugin is registered as always-active (the framework's `availablePlugins` model may need StyleGuide moved out of "available, opt-in" into "always on").

### Concurrency
- All writes funnel through plugin methods. Plugin holds an in-process `Promise` queue so concurrent PATCHes don't interleave file writes. (Episteme is single-server, single-workspace; this is sufficient.)

---

## 5. Server API changes (`packages/app-episteme/src/server/index.ts`)

Replace the existing two routes with a small REST surface. Keep all paths under `/api/style-guide`.

| Route | Purpose |
| --- | --- |
| `GET /api/style-guide` | `{ sections: StyleSection[], budget: { used, cap, droppedSectionIds } }` |
| `POST /api/style-guide/sections` | Body `{ title, body }` → returns created `StyleSection` |
| `PATCH /api/style-guide/sections/:id` | Body `{ title?, body?, enabled? }` → returns updated `StyleSection` |
| `DELETE /api/style-guide/sections/:id` | 204 |
| `PUT /api/style-guide/order` | Body `{ orderedIds: string[] }` → 200 |
| `GET /api/style-guide/library` | `{ items: Array<{ slug, title, preview }> }` |
| `POST /api/style-guide/library/:slug/import` | Creates a section from the library entry; returns created `StyleSection` |

Drop the legacy `PATCH /api/style-guide` raw-text route. If we want temporary back-compat (CLI users, scripts) we can keep it as a one-shot that writes to a `Default` section, but I'd rather just delete it.

---

## 6. Settings UI — `Style` section

Replace `packages/app-episteme/src/components/features/settings/sections/StyleSection.tsx` with a feature folder. Per the components convention, this is feature-internal UI (not a new composite) and lives inside the existing `features/settings/sections/` tree.

### File layout
```
features/settings/sections/style/
├─ StyleSection.tsx          — root: fetches, owns state, calls API
├─ SectionList.tsx           — left column: ordered list, drag handle, enable checkbox, delete
├─ SectionEditor.tsx         — right column: title input + body Textarea (autosize)
├─ BudgetMeter.tsx           — shows "1,400 / 4,000 chars" + dropped warning
├─ LibraryPicker.tsx         — modal listing shipped starter sections
├─ EmptyState.tsx            — single-textarea fast path; "split into sections" CTA
└─ types.ts                  — local API types (mirror server contract)
```

### Behavior

- **Empty state.** Zero sections → render a single autosizing `Textarea` with placeholder rules and Save. Save creates one section titled "Default". Below the textarea: a small "Browse library" link that opens `LibraryPicker`.
- **Populated state.** Two-column layout. Left list shows each section with drag handle, `Checkbox`, title text, delete `IconButton`. Right pane shows the selected section's `Input` (title) and `Textarea` (body, autosize). Add-section button at the bottom of the left column. "Import from library" button next to it.
- **Header.** Replaces the legacy `<h2>Style guide</h2>` with `SectionHeading` (existing composite) plus a `StatusPill` ("Active · N sections" or "Inactive") and a `BudgetMeter`.
- **Drag-to-reorder.** Reorder fires `PUT /api/style-guide/order`. Optimistic update locally; revert on failure.
- **Save behavior.** Debounced auto-save (400ms after typing stops) on title/body. Toggle and reorder save immediately. Status pill replaces the bottom Save button. No Clear All button (delete each section explicitly to avoid accidents).
- **Drag library.** Use HTML5 drag-and-drop directly inside `SectionList`. Per the components convention, we'd add a `DragList` composite *only* if a second feature needs it. v1 stays inline.

### Composite reuse
- `ModalShell` for `LibraryPicker`.
- `SectionHeading`, `StatusPill`, `Disclosure` (for the library entries showing a preview), `EmptyState`.
- Primitives: `Input`, `Textarea`, `Button`, `IconButton`, `Checkbox`, `Text`.

### CSS
- `styles/features/style-section.css`. New classes `.ep-style-section__list`, `.ep-style-section__editor`, `.ep-style-section__meter`. Add to `styles.css`.
- Drop legacy `.modal-textarea` / `.modal-footer` usage in the replaced file.

### Removal
- Delete `sections/StyleSection.tsx`; update `sections/index.ts` to re-export from `sections/style/StyleSection.tsx`.
- No change to `SettingsPanel.tsx` itself — the `<StyleSection />` import path stays the same via the barrel.

---

## 7. Starter library

Ship the library as TypeScript-imported markdown so it's bundled with the app (no fetch, no install).

```
packages/app-episteme/src/plugins/style-guide/library/
├─ index.ts                  — exports the manifest
├─ concise-voice.md
├─ plain-language.md
├─ british-english.md
├─ academic-citation.md
├─ coder-voice.md
├─ fiction-pov.md
└─ em-dash-discipline.md
```

`index.ts` exposes `{ slug, title, preview, body }[]` — `preview` is the first ~140 chars for the picker UI. Initial set is the seven above; we can grow this without code changes by adding `.md` files and registering them in `index.ts`.

Authoring guidance (to keep starters tight):
- Single concern per starter (no compound roles).
- 80–250 words.
- Imperative voice ("Use active verbs"; not "active verbs should be used").
- No "you are…" preamble — the agent already has identity.

---

## 8. Migration

On `onInit`:
1. If `.episteme/style-guide/manifest.json` exists, load normally and stop.
2. Else, check `.episteme/style-guide.md`:
   - If it exists and is non-empty: create `.episteme/style-guide/` directory, write `default.md` with the content, write `manifest.json` with `{ sections: [{ id: "default", title: "Default", enabled: true, order: 0 }] }`. Move (don't delete) the old file to `.episteme/style-guide.legacy.md` so power users can recover it.
   - If empty or missing: write an empty `manifest.json`. No sections.

The migration is idempotent. Re-running it on an already-migrated workspace is a no-op (manifest exists).

---

## 9. Implementation order

1. **Plugin rewrite.** Section model, file I/O, in-memory cache, methods, budget logic. Unit-test in isolation against a tmp workspace.
2. **Always-on activation.** Remove activation gate; verify plugin appears in `activePlugins` from boot; delete `getInactiveHint`.
3. **Migration.** Wire the legacy-file → Default-section path into `onInit`.
4. **Server routes.** Replace the two old routes with the seven new ones. Delete the raw-text PATCH.
5. **Library content.** Author 5–8 starter `.md` files and register them in `library/index.ts`.
6. **UI — empty + single-section path.** Replace `StyleSection.tsx` with the new feature folder, but get the *empty + single-section* path working end-to-end first (no drag, no list view). Validates the API wire format.
7. **UI — multi-section list.** Add `SectionList` with toggles, delete, add-section, drag-to-reorder.
8. **UI — library picker.** `LibraryPicker` modal + import flow.
9. **Budget meter.** Wire `BudgetMeter` to the `/api/style-guide` response.
10. **Verification.** Per CLAUDE.md, start the dev server and exercise: empty state, save first section, add section, toggle, reorder, delete, import from library, exceed budget, restart server (state persists).

Each step can land as its own commit on the current `UI-componentization` branch (or a new `style-guide-builder` branch — recommend the latter so this stays separable from the in-flight componentization work).

---

## 10. Open items / risks

- **Drag-and-drop library or roll-your-own?** Episteme has no drag composite today. HTML5 DnD inline is fine for v1 (one feature, one list). If a second feature needs it (plan step reorder is the obvious candidate), promote to a `DragList` composite then.
- **Where exactly is StyleGuide registered as available vs always-active?** The framework's `availablePlugins` / `activePlugins` model needs a clear "always on" entry; need to confirm whether the bundle init code at `packages/app-episteme/src/server/index.ts` startup needs a code change or just a config change.
- **Token-vs-char budget.** 4,000 chars is a proxy for ~1,000 tokens. If we later want true token accounting, the meter can call into the provider's tokenizer. Out of scope for v1.
- **Concurrent edits.** Two tabs editing the same section will last-write-wins. Acceptable for v1; Episteme is single-user.
- **Section IDs.** Slug collisions on create (`title: "Default"` twice) need a suffix scheme (`default`, `default-2`). Trivial but worth getting right.
- **No tools, but should the model *know* a style guide is active?** It does, by virtue of seeing the `## Style Guide` header in its system prompt. That's sufficient — no separate signal needed.

---

## 11. v2+ sketch (not in scope, for forward-compat sanity check)

When experts land, the manifest grows:

```jsonc
{
  "version": 2,
  "sections": [ /* unchanged */ ],
  "experts": [
    { "id": "researcher", "name": "Researcher", "sectionIds": ["academic-citation", "concise-voice"] }
  ],
  "activeExpertId": "researcher" // or null
}
```

The plugin's `getSystemPromptFragment` becomes: union of `(sections where enabled) ∪ (sections where id ∈ activeExpert.sectionIds)`. Settings gains an "Experts" tab. A new status-bar switcher reads/writes `activeExpertId`. No data migration needed — v1 manifests are valid v2 manifests with no experts.

Nothing in v1 paints us into a corner for this.
