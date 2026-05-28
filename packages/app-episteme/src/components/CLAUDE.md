# Episteme UI components

A three-tier component system: **primitives → composites → features**.
The split exists so visual logic is reusable, feature components stay
thin, and CSS doesn't sprawl. The full rationale (with the original
audit) lives in `docs/Episteme_UI_Componentization_Plan.md` — this
file is the practical reference.

## Where things live

```
components/
├─ primitives/      — stateless, no domain types, scoped CSS in
│                     styles/primitives/<name>.css
├─ composites/      — stateless, compose primitives; may own purely
│                     visual state (open/closed, focused index); CSS
│                     in styles/composites/<name>.css
├─ features/        — stateful feature folders that consume contexts,
│                     call APIs, and orchestrate composites
└─ <a few legacy files at the root>  — see "Not yet migrated" below
```

CSS aggregators: `styles/primitives/index.css`, `styles/composites/index.css`.
Both are pulled in by `styles.css`.

## When to use what

| You're building... | Reach for... |
|---|---|
| A button, input, chip, badge, dot, divider, kbd, spinner | a **primitive** — import from `components/primitives/` |
| A modal, popover, menu, tabs, form field, list row, disclosure, panel chrome | a **composite** — `components/composites/` |
| A stateful piece of UI tied to context/API (panel, modal flow) | a **feature folder** — `components/features/<name>/` |

If you find yourself reaching for a `<button>` or `<input>` directly,
you almost certainly want the primitive. If you find yourself rebuilding
a modal overlay, you want `ModalShell`.

## Primitives

All exported from `components/primitives/`. CSS class root: `.ep-<name>`.

| Component | Purpose | Key props |
|---|---|---|
| `Icon` | Wraps a `lucide-react` component with consistent default size | `icon: LucideIcon`, `size: 'xs'\|'sm'\|'md'\|'lg'\|number` |
| `Button` | The only `<button>` in the app | `variant: 'solid'\|'ghost'\|'danger'\|'link'`, `size: 'sm'\|'md'`, `shape: 'rect'\|'square'\|'circle'`, `iconLeft`, `iconRight`, `loading`, `ref` |
| `IconButton` | Alias of `Button` that requires `icon` + `aria-label` | `icon: ReactNode`, `aria-label: string` (required) |
| `Text` | Typography primitive | `as`, `variant: 'body'\|'caption'\|'label'\|'code'\|'mono'\|'heading'`, `tone: 'default'\|'muted'\|'dim'\|'accent'\|'danger'\|'success'\|'warning'` |
| `Input` | Text input with optional prefix/suffix slots | `size`, `invalid`, `prefix`, `suffix`, `ref` |
| `Textarea` | Multi-line input with optional autosize | `autosize`, `maxAutosizeRows`, `invalid`, `ref` |
| `Checkbox` | Styled native checkbox | `checked`, `onChange(boolean)`, `label` |
| `Radio` | Styled native radio | `checked`, `onChange(value)`, `name`, `value`, `label` |
| `Select` | Styled native `<select>` | `value`, `onChange(value)`, `options: SelectOption[]`, `placeholder` |
| `Chip` | Small pill with optional icon and remove control | `tone: 'neutral'\|'info'\|'warn'\|'danger'\|'success'`, `iconLeft`, `onRemove` |
| `Badge` | Inline status indicator (denser than Chip) | same tones as Chip |
| `Spinner` | `Loader2` with `ep-spin` animation baked in | `size` |
| `Dot` | Colored status dot | `tone: 'neutral'\|'muted'\|'info'\|'warn'\|'danger'\|'success'`, `pulse` |
| `Kbd` | Keyboard-key glyph | — |
| `Divider` | Horizontal or vertical rule | `orientation` |
| `Surface` | Padded/elevated/bordered div | `elevation`, `padding`, `bordered` |
| `ScrollArea` | Scroll container with project scrollbar styling | `axis: 'y'\|'x'\|'both'`, `scrollRef` |

`Button`, `IconButton`, `Input`, and `Textarea` forward refs. Variant
props are string-literal unions (not booleans) so the call site can
grow new variants without breaking callers.

## Composites

All exported from `components/composites/`. CSS class root: `.ep-<name>`.

| Component | What it is | Notes |
|---|---|---|
| `ModalShell` | Overlay + framed surface + header/body/footer slots | Built-in Esc + backdrop dismissal (`closeOnEsc` / `closeOnBackdrop` to override). Don't render a custom overlay — use this. |
| `ConfirmDialog` | `ModalShell` + message + Cancel/Confirm buttons | `danger` prop styles the confirm button red. |
| `Popover` | Fixed-positioned floating container anchored to a ref | `anchorRef`, `placement: 'bottom-start'\|...`, internal click-outside + Esc. No portal. |
| `Menu` | `Popover` + list of `MenuItem` (or `MenuDivider`) entries | Takes `items: MenuEntry[]`; danger items get red styling. |
| `ContextMenu` | Same items API as `Menu` but positioned at `(x, y)` cursor coords | Use for right-click menus. |
| `PanelShell` | Side/bottom panel chrome: header + body + optional resize handle | Pairs with `ResizeHandle`. |
| `ResizeHandle` | Narrow draggable strip pinned to left or right edge | Wire to `usePanelResize`'s `handleMouseDown`. |
| `Toolbar` | Flex row of `IconButton` / `Button` with `Divider`s between groups | `ariaLabel`, `orientation`. |
| `Tabs` | Generic horizontal tab strip | Controlled: `value`, `onChange`, `tabs: TabDef[]`. Generic over the tab id type. |
| `FormField` | Label + control + description/error stack | Pass control as a ReactNode or a `(props: {id})` render-prop. |
| `RadioGroup` | Several `Radio` primitives with a shared `name` | — |
| `CheckboxGroup` | Several `Checkbox` primitives with shared state | — |
| `ListRow` | Flex row: icon + main + meta + actions slots | Actions slot fades in on hover/focus. |
| `KeyValueRow` | Left label + right value | — |
| `Disclosure` | Chevron + summary header with collapsible body | Controlled or uncontrolled. |
| `EmptyState` | Centered icon + title + description + optional CTA | — |
| `StatusPill` | `Dot` + label inline | — |
| `SectionHeading` | Small uppercase heading with optional trailing slot | — |
| `InlineLoading` | `Spinner` + accompanying text | — |
| `DiffView` | Line-by-line additions/removals/context | `rows: DiffRow[]` — produce them with whatever LCS algorithm you like. |

Composites may own *visual* state (open/closed, focused index) but
**never** application state and **never** fetch.

## Feature folders

Each lives in `components/features/<feature-name>/` and follows this shape:

```
features/<feature-name>/
├─ FeatureName.tsx         — root: consumes contexts, owns state, calls APIs
├─ <SubComponent>.tsx      — focused chunks (rows, sections, forms)
├─ types.ts                — shared types/enums
├─ constants.ts            — labels, configs
└─ <helpers>.ts            — pure helpers (parsing, formatting)
```

Feature-specific CSS lives in `styles/features/<feature-name>.css`
(see `ai-sidecar.css` for the reference). Most features instead just
reuse legacy layout classes — see below.

Existing features:
- `ai-sidecar/` — AISidecar root + SidecarPanel + ChatModal + MessageList
  + 8 row components + ChatComposer + 5 composer pieces
- `settings/` — SettingsPanel root + SettingsNav + 5 section files +
  ToggleSwitch + SettingsRow + ColorSwatchGroup
- `plan-panel/` — PlanPanel root + PlanActionBar + PlanRequestForm +
  step row/editors + AddStepForm
- `file-tree/` — FileTree root + Dir/FileRow + RenameInput +
  NewItemInput + IndentGuides + FileTreeContextMenu + DeleteConfirmDialog
- `unified-search/` — UnifiedSearch root + ScopeTabs + SearchInput +
  4 result-row types
- `research-panel/` — ResearchPanel root + ResearchSearchForm +
  ResearchTabs + ResearchResultRow + ResultList + GapReportSection +
  GapReportModal
- `permission-dialog/` — PermissionDialog root + PermissionPrompt +
  ToolArgsView + FileDiffView
- `onboarding/` — OnboardingModal root + ModelSelectStep +
  OllamaUnreachableState
- `toc-panel/` — TocPanel root + TocEntry
- `conflicts-panel/` — ConflictsPanel root + ConflictItem

## Conventions

### Class naming
- Primitives: `.ep-<name>` and `.ep-<name>__<part>` (BEM-ish).
- Composites: same — `.ep-modal`, `.ep-modal__overlay`, `.ep-modal__body`.
- Feature-specific: `.ep-<feature>__<part>` (e.g. `.ep-sidecar__composer`).
- Legacy classes that still apply (`.model-config-*`, `.settings-overlay`,
  `.permission-dialog-*`, `.file-tree-*`) are documented inline in
  `styles/modals.css` and the sidebar/panels stylesheets.

### Refs
`Button`, `IconButton`, `Input`, `Textarea` accept a `ref` prop and
forward it to the underlying DOM node (React 19 ref-as-prop). If you
need a ref on another primitive, add it the same way — don't reach for
`forwardRef`.

### Tone system
`Text`, `Chip`, `Badge`, `Dot`, `StatusPill` share the tone vocabulary
(`neutral` / `info` / `warn` / `danger` / `success`, with `muted` / `dim`
on `Text` and `Dot`). When you need a color, pick a tone first.

### When to override primitive styling
Sometimes a primitive sits inside a context where its default frame
clashes (e.g. `Input` inside `LinkPicker`). Override scoped to the
container:

```css
.link-picker .ep-input {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border);
  ...
}
```

Don't add new primitive variants for one-off contexts. Don't fork the
primitive.

### Legacy CSS coexistence
Some classes from the pre-migration era still apply: `.modal-desc`,
`.modal-footer`, `.modal-textarea`, `.model-config-*`, `.settings-*`,
`.permission-*`, `.color-swatch*`, `.help-*`, `.panel-drag-handle`.
These are layout/typography helpers that haven't been absorbed into
composites yet. They're safe to reuse — and existing features still do
— but new code should prefer primitives where there's a direct
substitute (Button > `.modal-btn-primary`, Text > `.modal-status-ok`).

## Playbook: adding a new feature

1. **Decide the surface.** Modal? Side panel? Inline composer? Pick the
   composite that gives you the chrome (`ModalShell`, `PanelShell`,
   `Popover`).
2. **Sketch the structure.** Root component + 2–6 focused subcomponents.
   Avoid the temptation to split into 12 files when 4 will do.
3. **Create `features/<name>/`** with `FeatureName.tsx` and any
   subcomponents in the same folder. Helpers go in `<name>.ts` files.
4. **Use primitives for every input/button/icon.** Reach for composites
   for repeating layout patterns (rows, lists, sections, modals,
   menus). Don't reinvent.
5. **Keep the root component focused on state.** Subcomponents take
   props and emit events; they shouldn't reach back into context.
6. **Add feature CSS only if needed** at `styles/features/<name>.css`
   and import it from `styles.css`. Most features get away without it.
7. **Wire from `App.tsx`** and run the app to verify (CLAUDE.md
   requires a visual pass for UI work — see "Running" below).

## Playbook: adding a new primitive or composite

The bar is **"used in at least one feature."** Don't add speculative
primitives. When you do add one:

- Create `components/primitives/<Name>.tsx` (or `composites/<Name>.tsx`).
- Create `styles/primitives/<name>.css` (or `composites/<name>.css`).
- Add to the matching `styles/<tier>/index.css` aggregator.
- Add to the matching `components/<tier>/index.ts` barrel export.
- Update the table in this file.
- Strict-typed props, no `any`, no implicit `children: ReactNode`,
  variant props as string-literal unions.
- For composites that own visual state, keep that state internal
  (refs, useState for open/index). Never useFetch / never useContext
  to read app state.

## Anti-patterns to avoid

- **Bare `<button>` / `<input>`** — use `Button` / `Input`. Even one-off
  controls should use the primitive so they pick up theme/focus/disabled
  behavior for free.
- **Inline `<div className="modal-overlay">` or any DIY modal** — use
  `ModalShell`. It owns Esc + backdrop dismissal and the animation.
- **Importing types from feature components** — types belong in
  `<feature>/types.ts` or in `plugins/` or `state/`. Don't re-export
  domain types from random feature root files.
- **Putting visual state in context** — visual state (open/index/focus)
  lives in the composite or feature that needs it. App contexts are
  for app/domain state (messages, files, plans).
- **Adding a new primitive variant for a one-off** — prefer a scoped
  CSS override in the feature instead.

## Not yet migrated

Three legacy files remain at the components root:
- `MarkdownView.tsx` — small, already presentational, intentionally
  left alone.
- `PlanModeOptions.tsx` — already presentational.
- `PanelGroup.tsx`, `KnowledgeGraph.tsx` — these weren't part of the
  componentization plan. Migrate them only when touched for other
  reasons.

`Editor.tsx` (in `components/editor/`) stays as orchestrator per the
plan. Its sub-components (`MarkdownToolbar`, `BubbleMenu`, `LinkPicker`,
`FrontmatterPanel`) are already migrated.

## Running

The CLAUDE.md rule applies here: **for UI changes, start the dev server
and look at it in a browser before declaring done.** Type-check and
unit tests verify code correctness, not feature correctness. From the
repo root:

```bash
bun run episteme    # http://localhost:4000
```

Pass `--workspace=<path>` to point at a test workspace, e.g.
`bun packages/app-episteme/episteme.ts --workspace=/tmp/episteme-ws`.
