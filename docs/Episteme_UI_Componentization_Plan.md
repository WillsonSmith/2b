# Episteme UI Componentization Plan

Audit of `packages/app-episteme/src/components` and a proposed three-tier hierarchy
(Primitives → Composites → Feature Components). Goal: shrink Feature Components,
push presentation into reusable stateless units, and make new features cheap to
assemble.

---

## 1. Audit Summary

### 1.1 Current state

All files under `src/components` currently behave as Feature Components — they
own state, fetch data, and render presentation in one place. Sizes (lines):

| File | Lines | Notes |
|---|---:|---|
| `editor/Editor.tsx` | 961 | tiptap shell + toolbar wiring + autocomplete + paste handlers |
| `AISidecar.tsx` | 858 | resizable panel + 5 inner components (`MessageList`, `ChatInput`, `ChatModal`, `AssistantMessage`, `FileMentionChip`) |
| `SettingsPanel.tsx` | 781 | 5 sections, each its own form layout |
| `PlanPanel.tsx` | 726 | `StepRow` + plan header + editing UI |
| `FileTree.tsx` | 639 | tree, context menu, confirm dialog, rename input |
| `UnifiedSearch.tsx` | 383 | tabs + 4 result-list variants |
| `ResearchPanel.tsx` | 321 | tabs + result rows + `GapReportModal` |
| `editor/FrontmatterPanel.tsx` | 268 | form rows |
| `editor/MarkdownToolbar.tsx` | 253 | icon-button toolbar |
| `PermissionDialog.tsx` | 240 | modal + diff view |
| `OnboardingModal.tsx` | 197 | modal + form |
| `KnowledgeGraph.tsx` | 192 | canvas/svg renderer |
| `TocPanel.tsx` | 116 | list panel |
| `PanelGroup.tsx` | 99 | layout |
| `editor/LinkPicker.tsx` | 96 | popup + input |
| `editor/BubbleMenu.tsx` | 87 | floating toolbar |
| `PlanModeOptions.tsx` | 62 | already stateless ✅ |
| `ConflictsPanel.tsx` | 57 | list |
| `MarkdownView.tsx` | 43 | already presentational ✅ |

### 1.2 Recurring patterns (extraction targets)

Observed across multiple Feature Components — currently duplicated:

- **Icon-only / icon+text buttons** with circular, square, and ghost variants
  (`header-icon-btn`, `sidecar-delete-btn`, `sidecar-quick-toggle`,
  `sidecar-send`, `sidecar-interrupt`, `modal-close`, `plan-btn`,
  `file-tree-confirm-btn`, etc.).
- **Status pill / dot** (`sidecar-status` with `Circle`/`CircleDashed`/`CircleDot`,
  `modal-status-ok`/`modal-status-err`).
- **Disclosure row** (`details`/`summary` blocks for tool rows, plan steps,
  mention chips — same anatomy: chevron + icon + label + status + body).
- **Modal scaffold** (`modal-overlay` → `modal` → `modal-header` /
  `modal-close` / body — repeated in `ChatModal`, `GapReportModal`,
  `PermissionDialog`, `OnboardingModal`, `SettingsPanel`).
- **Resizable panel chrome** (`panel-drag-handle` + `usePanelResize` —
  duplicated in `AISidecar` and `FileTree`).
- **Dropdown menu** (`sidecar-msg-dropdown`, `file-tree-context-menu`,
  `sidecar-mention-dropdown` — same: positioned list of action buttons,
  click-outside to dismiss).
- **Confirm dialog** (`file-tree-confirm-dialog` — currently bespoke; modal
  wrapper + message + Cancel/Confirm).
- **Chip with remove** (`sidecar-mention-chip`, future tag chips).
- **Form field** (label + input + description — repeated throughout
  `SettingsPanel`, `OnboardingModal`, `FrontmatterPanel`).
- **Radio / checkbox group** (`PlanModeOptions` already does this; settings
  re-implements it).
- **Spinner / loading state** (`Loader2` + `icon-spin` everywhere).
- **Empty-state placeholder** (`sidecar-empty`, `file-tree-empty`).

### 1.3 Problems to solve

1. **State lives next to markup**, so every visual tweak requires reading
   logic. Feature Components are 250–950 lines.
2. **No reusable button.** `<button className="…">` appears ~80× with
   ad-hoc styling.
3. **No reusable modal.** Each modal re-creates the overlay/header/close.
4. **Inner components are nested inside Feature files** (e.g. `StepRow` lives
   inside `PlanPanel.tsx`), so they can't be reused and their tests can't be
   isolated.
5. **CSS class names encode hierarchy** (`sidecar-msg-header`,
   `plan-step-summary`), so a class can't move without breaking layout —
   primitives must own their CSS by class.

---

## 2. Proposed Hierarchy

### 2.1 Primitives — `components/primitives/`

Stateless, no side effects, no domain types. Props drive everything.

| Component | Purpose | Variants / Props |
|---|---|---|
| `Icon` | thin wrapper around `lucide-react` for consistent default size/color | `name`, `size`, `className` |
| `Button` | the only `<button>` in the app | `variant: solid \| ghost \| danger \| link`; `size: sm \| md`; `shape: rect \| square \| circle`; `iconLeft`, `iconRight`, `iconOnly`; `loading`; `disabled` |
| `IconButton` | thin alias of `Button` with `iconOnly` + `aria-label` required | same as `Button` |
| `Text` | typography primitive | `as: span\|p\|h1…h4`, `variant: body\|caption\|label\|code\|mono` |
| `Input` | text input | `size`, `invalid`, `prefix`, `suffix` |
| `Textarea` | autosize textarea | `rows`, `autoFocus`, `resize` |
| `Checkbox` | styled checkbox | `checked`, `onChange`, `label` |
| `Radio` | styled radio | `checked`, `onChange`, `label`, `name`, `value` |
| `Select` | native `<select>` styled | options array |
| `Chip` | small pill | `tone: neutral\|info\|warn\|danger\|success`; `onRemove?` |
| `Badge` | inline status badge | same tones |
| `Divider` | horizontal/vertical rule | `orientation` |
| `Spinner` | `Loader2` with `icon-spin` baked in | `size` |
| `Dot` | colored status dot | `tone` |
| `Kbd` | keyboard-key glyph | text |
| `Surface` | styled `div` with padding/radius/elevation tokens | `elevation`, `padding` |
| `ScrollArea` | scrollable container with project scrollbar styling | `axis` |

CSS lives in `styles/primitives.css`, scoped by `.ep-<name>` class.

### 2.2 Composites — `components/composites/`

Stateless. Compose primitives. May own *visual* state (open/closed,
focused index) but never *application* state and never fetch.

| Component | Composed from | Used by |
|---|---|---|
| `FormField` | `Text` (label) + slot + `Text` (description/error) | settings, onboarding, frontmatter |
| `RadioGroup` | `Radio` × n | `PlanModeOptions`, settings |
| `CheckboxGroup` | `Checkbox` × n | settings |
| `Toolbar` | row of `IconButton`s with `Divider`s | `MarkdownToolbar`, `ComposerToolbar` |
| `Disclosure` | `details/summary` shell — slots for `summary` and `content` | tool rows, plan-step rows, mention chips |
| `ListRow` | flex row: icon slot + main slot + meta slot + actions slot | file-tree rows, message-list items, search results |
| `Menu` | floating panel of action items + click-outside | dropdowns in `AssistantMessage`, `FileTree` |
| `ContextMenu` | `Menu` positioned at cursor | `FileTree` right-click |
| `Popover` | floating positioned container (controlled `open`) | `LinkPicker`, `BubbleMenu`, mention dropdown |
| `Tabs` | tab strip + content slot | `UnifiedSearch`, `ResearchPanel`, `FileTree` tabs |
| `ModalShell` | overlay + framed surface + header (title slot + close `IconButton`) + body slot + footer slot | every modal |
| `ConfirmDialog` | `ModalShell` + message + Cancel/Confirm `Button`s | `FileTree` delete confirm |
| `PanelShell` | header (title + action slot) + body slot + optional resize handle | `AISidecar`, `FileTree`, `PlanPanel`, `SettingsPanel`, `TocPanel` |
| `ResizeHandle` | drag handle wired to a callback | inside `PanelShell` |
| `EmptyState` | centered icon + text + optional CTA | `sidecar-empty`, `file-tree-empty` |
| `StatusPill` | `Dot` + label | `sidecar-status` (ready/thinking/offline) |
| `KeyValueRow` | left label + right value | settings rows, help shortcuts |
| `SectionHeading` | small uppercase heading | settings sections, sidecar |
| `InlineLoading` | `Spinner` + text | "Loading…", "Thinking…" |
| `DiffView` | line-by-line additions/removals (pure) | `PermissionDialog` |

### 2.3 Feature Components — `components/features/`

Stateful. Consume state contexts, call APIs, orchestrate composites.
After decomposition, each feature is a thin wiring layer; the visual
parts are reusable.

#### `features/ai-sidecar/` (replaces `AISidecar.tsx`)

```
AISidecar.tsx                       — root, wires AI context, owns expanded modal flag
├─ SidecarPanel.tsx                 — composite shell wrapping the in-page panel (uses PanelShell)
├─ ChatModal.tsx                    — full-screen view (uses ModalShell)
├─ MessageList.tsx                  — maps messages → row component, owns scroll
│  ├─ UserMessageRow.tsx            — header + body + mention footer
│  ├─ AssistantMessageRow.tsx       — header + Menu + MarkdownView + FollowUpComposer
│  ├─ ToolRow.tsx                   — Disclosure with status icon
│  ├─ PlanStepRow.tsx               — Disclosure (already exists inline)
│  ├─ NotificationRow.tsx           — text + action Button
│  ├─ SystemEventRow.tsx            — icon + text
│  ├─ EmptyResponseRow.tsx          — warning + Retry Button
│  └─ ThinkingIndicator.tsx         — InlineLoading
├─ ChatComposer.tsx                 — input area orchestrator (replaces ChatInput)
│  ├─ QuickActionsPanel.tsx         — grid of Buttons
│  ├─ MentionDropdown.tsx           — Popover + ListRow items
│  ├─ FollowUpBadge.tsx             — Chip with cancel
│  ├─ ComposerTextarea.tsx          — Textarea with @-mention key handling
│  └─ ComposerToolbar.tsx           — Toolbar of mode IconButtons + StatusPill + send
├─ FollowUpComposer.tsx             — used inline in AssistantMessageRow
└─ FileMentionChip.tsx              — Chip + Disclosure for inline file refs
```

#### `features/plan-panel/` (replaces `PlanPanel.tsx`)

```
PlanPanel.tsx                       — root, consumes PlanningContext
├─ PlanHeader.tsx                   — title + controls (Play/Pause/Reset)
├─ PlanStepList.tsx                 — maps steps → StepRow
│  ├─ PlanStepRow.tsx               — Disclosure + StatusPill + reorder controls
│  ├─ PlanStepSummaryEditor.tsx     — Textarea + Save/Cancel
│  └─ PlanStepInstructionEditor.tsx — Textarea + Save/Cancel
└─ PlanStepDraftRow.tsx             — for new draft steps
```

#### `features/settings/` (replaces `SettingsPanel.tsx`)

```
SettingsPanel.tsx                   — root, owns active section + close animation
├─ SettingsNav.tsx                  — vertical Tabs
├─ sections/
│  ├─ StyleSection.tsx              — color swatches + form fields
│  ├─ WritingAidsSection.tsx        — CheckboxGroup
│  ├─ ModelsSection.tsx             — FormField × n
│  ├─ PermissionsSection.tsx        — ListRow + Select per tool
│  └─ HelpSection.tsx               — KeyValueRow × n (key + desc)
└─ ColorSwatchGroup.tsx             — composite reusable across sections
```

#### `features/file-tree/` (replaces `FileTree.tsx`)

```
FileTree.tsx                        — root, consumes FileContext
├─ FileTreeHeader.tsx               — Tabs + new-file IconButton + refresh
├─ FileTreeList.tsx                 — virtualized list
│  ├─ FileRow.tsx                   — ListRow + rename input
│  ├─ DirRow.tsx                    — ListRow + chevron
│  ├─ NewFileInput.tsx              — inline Input
│  └─ NewFolderInput.tsx            — inline Input
├─ FileTreeContextMenu.tsx          — ContextMenu (composite) + items
└─ DeleteConfirmDialog.tsx          — ConfirmDialog (composite)
```

#### `features/unified-search/` (replaces `UnifiedSearch.tsx`)

```
UnifiedSearch.tsx                   — root modal, owns query + scope
├─ SearchInput.tsx                  — Input with leading icon + scope hint
├─ ScopeTabs.tsx                    — Tabs
└─ results/
   ├─ FileResultRow.tsx             — ListRow
   ├─ FullTextResultRow.tsx         — ListRow with snippet
   ├─ ResearchResultRow.tsx         — ListRow with source Badge
   └─ CommandResultRow.tsx          — ListRow
```

#### `features/permission-dialog/` (replaces `PermissionDialog.tsx`)

```
PermissionDialog.tsx                — root, owns FIFO queue + ws send
├─ PermissionPrompt.tsx             — ModalShell + body
├─ ToolArgsView.tsx                 — pre-formatted args
└─ FileDiffView.tsx                 — uses composite DiffView
```

#### `features/onboarding/` (replaces `OnboardingModal.tsx`)

```
OnboardingModal.tsx                 — root, owns load state + submit
├─ ModelSelectStep.tsx              — FormField + Select × 2
└─ OllamaUnreachableState.tsx       — EmptyState + retry Button
```

#### `features/research-panel/` (replaces `ResearchPanel.tsx`)

```
ResearchPanel.tsx                   — root
├─ GapReportSection.tsx
├─ GapReportModal.tsx               — uses ModalShell
└─ ResultList.tsx                   — uses Tabs + result rows (reuses search-result rows)
```

#### Other features (lighter touch)

- `features/editor/` — keep `Editor.tsx` as orchestrator; extract
  `EditorToolbar` (uses `Toolbar`), `EditorBubbleMenu` (uses `Popover`),
  `LinkPicker` (uses `Popover` + `Input`), `FrontmatterPanel` (uses
  `FormField`s).
- `features/toc-panel/` — `TocPanel.tsx` uses `PanelShell` + `ListRow`s.
- `features/conflicts-panel/` — `ConflictsPanel.tsx` uses `PanelShell` + `ListRow`s.
- `features/knowledge-graph/` — `KnowledgeGraph.tsx` stays as-is
  (specialized renderer; not worth decomposing).

---

## 3. Styling Strategy

- **CSS variables in `styles/tokens.css`** — colors, spacing, radii, font
  sizes, elevations. Already partially present in `themes.css` / `base.css`;
  consolidate.
- **One CSS file per primitive** (`styles/primitives/button.css`,
  `styles/primitives/input.css`, …) imported once.
- **Composites get their own CSS** (`styles/composites/modal-shell.css` etc.).
- **Feature components keep only feature-specific CSS** (e.g.
  `styles/features/ai-sidecar.css` for layout that's truly unique to the
  sidecar). The current sprawling `sidecar.css` / `panels.css` / `modals.css`
  collapse as primitives absorb their patterns.
- **Class naming**: `.ep-<component>` for primitives, `.ep-<composite>` for
  composites, `.ep-feature-<name>__<part>` for feature-specific layout.
- No CSS-in-JS, no Tailwind — per constraints.

---

## 4. Type-Safety Conventions

- Every primitive and composite exports a `Props` interface; no `any`,
  no implicit `children: ReactNode` unless explicitly typed.
- Variant props use string literal unions (`variant: "solid" | "ghost"`),
  not booleans, so adding a variant doesn't break callers.
- Domain types (`SidecarMessage`, `EpistemePlan`, etc.) only appear in
  Feature Components — primitives/composites take generic shapes
  (e.g. `ListRow` takes `icon: ReactNode`, not a domain type).
- Callbacks pass *data*, not events, where possible (`onSelect: (path: string) => void`,
  not `onClick: (e: MouseEvent) => void`), so the consumer doesn't deal in DOM.

---

## 5. Definition-of-Done Checks

For each primitive/composite added:

- [ ] No `useState`/`useEffect` except for purely-visual local state (hover,
      open) — never application state.
- [ ] No `fetch`, no context consumption, no signal reads.
- [ ] Props are strictly typed; no `any`, no `Record<string, unknown>` in the
      public surface.
- [ ] CSS lives next to the component in a dedicated file.
- [ ] Renders correctly with icon-only, icon+text, disabled, and loading
      states where applicable.
- [ ] Used in at least one Feature Component (no speculative components).

---

## 6. Suggested Execution Order

Build bottom-up; do not start a feature decomposition until its primitives
exist.

1. **Tokens + Primitives** (`Button`, `IconButton`, `Input`, `Textarea`,
   `Checkbox`, `Radio`, `Chip`, `Spinner`, `Surface`, `Text`).
2. **Core composites** (`ModalShell`, `PanelShell`, `Menu`, `Popover`,
   `Disclosure`, `ListRow`, `Toolbar`, `FormField`, `RadioGroup`,
   `StatusPill`, `EmptyState`, `ConfirmDialog`).
3. **Migrate one feature end-to-end as the reference**: `AISidecar` (highest
   leverage — 858 lines, many duplicated patterns).
4. **Migrate remaining features**, ordered by size:
   `Editor`, `SettingsPanel`, `PlanPanel`, `FileTree`, `UnifiedSearch`,
   `ResearchPanel`, then the smaller ones.
5. **Delete dead CSS** — after each feature migration, prune classes from
   `sidecar.css`/`panels.css`/`modals.css` that the new primitives replaced.

Each step is a discrete PR.
