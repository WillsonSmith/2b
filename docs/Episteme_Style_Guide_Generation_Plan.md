# Episteme Style Guide Generation — v1 Plan

Add "describe a style, get a well-formed section" to the style guide builder. The
user types a plain-language description ("punchy, skimmable voice for a tech
blog") and an LLM produces a section whose **body is shaped the way the agent
consumes it best** — imperative, single-concern, no preamble — ready to review
and add.

This builds on the section-based builder (`docs/Episteme_Style_Guide_Builder_Plan.md`,
shipped on `customize-styleguide`). It adds nothing to the always-on
`StyleGuidePlugin`; generation is a separate, explicitly-triggered helper.

---

## 1. Goal & scope

**Ship in v1:**
- A `StyleGuideGenerator` — a `HeadlessAgent` twin of `AIFillPlugin` with a strict
  meta-prompt that turns a description into one section (`{ title, body }`).
- `POST /api/style-guide/generate` → returns a **draft** `{ title, body }`. No
  persistence; the UI decides when to save.
- A `GenerateModal` in the Settings → Style feature (parallel to `LibraryPicker`):
  description box → Generate → preview → Regenerate / Add to guide.
- An entry point from the empty-state fast path and from the section toolbar
  ("Generate with AI", next to "Add section" / "Import from library").
- Graceful behavior when AI is disabled (button gated, route returns a clear 4xx).

**Explicitly deferred to v2+:**
- Multi-section decomposition (one broad description → several sections).
- "Refine this section" (pass an existing body + an instruction like "make it
  more concise").
- Streaming output. v1 is request/response with a spinner.
- A dedicated model key (`styleGen`); v1 uses `featureModel(config, "default")`.

**Out of scope:**
- An agent **tool** for generating the style guide. The builder plan deliberately
  keeps the style-guide tool surface at zero, and the user is wary of redundant
  LLM surfaces that chat already covers. Generation stays a deliberate Settings
  action the user reviews before it affects anything.

---

## 2. Decisions log

| Decision | Choice | Why |
| --- | --- | --- |
| Where generation lives | Standalone `StyleGuideGenerator` helper, **not** a method on `StyleGuidePlugin` and **not** an agent tool | Keeps the always-on plugin tool-free per the builder plan; generation is an LLM concern with its own lifecycle. |
| Pattern to copy | `AIFillPlugin` (HeadlessAgent + tight system prompt + one `generate()` method) | Proven one-shot generation path already in the codebase. |
| Trigger surface | Explicit Settings button → modal, not chat | Respects "no redundant LLM features"; user reviews output before it lands. |
| Persistence | Route returns a **draft**; UI persists via existing `POST /sections` on "Add" | LLM output is non-deterministic — preview-before-save matters more here than for the (curated, deterministic) library import. |
| Transient draft state | Held **inside the modal**, not in the main two-column UI | Avoids introducing an "unsaved section" concept into a model that otherwise auto-persists. |
| Output contract | First line `TITLE: <short title>`, blank line, then raw-markdown body | Robust to parse on local models; avoids JSON brittleness. Strip/fallback if the model disobeys. |
| Title source | Model-proposed in the same call | One round-trip; user can edit the title after Add like any section. |
| Model | `featureModel(config, "default")` | No new config surface in v1; matches AIFill. |
| AI-disabled handling | Gate the button; route returns 400 with a message | The style-guide REST API works with AI off, but generation needs a model. |

---

## 3. Generator component

```
packages/app-episteme/src/plugins/style-guide/StyleGuideGenerator.ts
```

A near-copy of `AIFillPlugin`'s shape, minus the plugin interface (it contributes
no fragment/tools/context, so it need not be a registered plugin):

```ts
export class StyleGuideGenerator {
  constructor(private config: EpistemeConfig) {}

  private agent: HeadlessAgent | null = null;
  private getAgent(): HeadlessAgent {
    if (!this.agent) {
      const llm = createProvider(featureModel(this.config, "default"));
      this.agent = new HeadlessAgent(llm, [], SYSTEM, { agentName: "StyleGuideGen" });
    }
    return this.agent;
  }

  /** Turn a plain-language description into a single draft section. */
  async generate(description: string): Promise<{ title: string; body: string }> {
    const raw = await this.getAgent().ask(`Style description:\n${description.trim()}\n\nWrite the section now.`);
    return parseTitleAndBody(raw);
  }
}
```

Wiring (in `createEpistemAgent`, `agent.ts`): construct it alongside the other
plugins and expose on the bundle as `styleGuideGenerator`. Do **not** register it
as a plugin — it has no hooks to contribute. (AIFill is registered only because
the original author made it a plugin; the generator doesn't need to be.)

### The meta-prompt (the heart of the feature)

This is what "best way to be interpreted" means in practice — it encodes the same
authoring guidance the shipped starter library follows:

```
You write a single section of a writing style guide. The user gives a
plain-language description of the style they want. Produce one focused
section that an AI writing assistant can follow directly.

Output format — exactly this, nothing else:
TITLE: <a short, human-readable title, 1–4 words>
<blank line>
<the section body in raw Markdown>

Rules for the body:
- Imperative voice. "Use active verbs", never "active verbs should be used".
- One concern only. If the description mixes several (voice + formatting +
  vocabulary), pick the dominant one and write that; do not sprawl.
- 80–250 words. Prefer a short intro line followed by a bullet list of rules.
- Concrete and checkable. "Break any sentence over 25 words" beats "be concise".
- No "you are…" preamble — the assistant already has an identity.
- No commentary, no "here is", no code fences around the whole answer.
```

Parsing (`parseTitleAndBody`): take the `TITLE:` line if present (else derive a
title from the first few words of the description); the rest is the body; strip a
wrapping code fence exactly like AIFill's `stripWrappingFence`.

---

## 4. Server API

One new route under the existing surface:

| Route | Purpose |
| --- | --- |
| `POST /api/style-guide/generate` | Body `{ description: string }` → `{ title, body }` (a draft, not persisted) |

- Trim and require a non-empty `description`; 400 otherwise.
- If AI is disabled (no started agent / no model), return 400 with
  `{ error: "Enable AI to generate style sections." }` so the UI can surface it.
- On model error, 500 with the error message (mirrors `handleAIFill`'s catch).
- The route reads `styleGuideGenerator` off the bundle in the server closure,
  alongside the other style-guide routes.

The existing `POST /api/style-guide/sections` is still what persists a section —
the modal calls it on "Add to guide". No change to the other six routes.

> AIFill is invoked over WebSocket (`ai_fill_request`/`ai_fill_result`) because it
> lives in the editor flow. Style generation is a self-contained request/response
> inside a Settings modal, so a REST route is the consistent choice with the rest
> of `/api/style-guide/*`.

---

## 5. UI changes — `sections/style/`

### New files
```
features/settings/sections/style/
├─ GenerateModal.tsx     — description box → Generate → preview → Regenerate / Add
└─ (GeneratePrompt.tsx)  — optional shared input+button if reused inline
```

### `GenerateModal` (mirrors `LibraryPicker`)
- `ModalShell` titled "Generate a style section".
- A `Textarea` for the description ("Describe the voice, tone, or rules you want…").
- **Generate** button → `POST /api/style-guide/generate`. Spinner while pending.
- On success, show a preview: the proposed title (`Input`, editable) + body
  (`Textarea`, editable). Buttons: **Regenerate** (re-calls with the same
  description) and **Add to guide**.
- **Add to guide** → `POST /api/style-guide/sections` with the (possibly edited)
  title/body, then closes and selects the new section. Reuses the root's existing
  create flow — pass an `onCreated(section)` callback rather than duplicating fetch
  logic.
- All transient draft state lives in the modal; the two-column UI is untouched
  until Add.

### Entry points
- **Section toolbar:** add a "Generate with AI" `Button` next to "Add section" and
  "Import from library" in `SectionList.tsx`'s action row.
- **Empty state:** a "Generate with AI" link beside "Browse library" in
  `EmptyState.tsx`, opening the same modal. (The manual textarea stays as the
  zero-AI fast path.)

### Gating when AI is off
- The root (`StyleSection.tsx`) already knows app state via context; pass an
  `aiEnabled` flag to disable the Generate entry points with a tooltip
  ("Enable AI in Models to generate"). Confirm where `aiEnabled` is readable —
  `App.tsx` tracks it; thread it into `SettingsPanel` → `StyleSection` if not
  already available.

### CSS
- Reuse `ep-style-section__library*` patterns; add `.ep-style-section__generate`
  only if the preview layout needs it. Likely no new stylesheet.

---

## 6. Risks / open items

- **Preamble leakage.** The most common failure is "You are a writer who…". The
  meta-prompt forbids it; if it persists on a given local model, add a cheap
  post-strip for a leading "You are"/"As a" sentence.
- **Format compliance on small models.** `TITLE:` + body is deliberately simpler
  than JSON, but still parse defensively and fall back to "untitled" + whole
  output as body.
- **Latency, no streaming.** Local models can take several seconds; v1 shows a
  spinner and disables the button. Streaming is a v2 nicety.
- **One concern vs. the user's broad ask.** v1 collapses a multi-faceted
  description into one section and says so implicitly by producing one. v2's
  decomposition is the real answer; set expectations in the modal copy
  ("Generates one focused section").
- **`aiEnabled` plumbing.** Need to confirm the flag reaches the Style feature;
  this is the only non-trivial wiring beyond the route.

---

## 7. Implementation order

1. **Generator + meta-prompt.** `StyleGuideGenerator.ts` + `parseTitleAndBody`.
   Unit-test parsing (TITLE present / absent / fenced / preamble) against fixed
   strings — no live model needed.
2. **Wire into bundle.** Construct in `agent.ts`, expose `styleGuideGenerator`.
3. **Server route.** `POST /api/style-guide/generate` with empty-input and
   AI-disabled guards. Smoke-test with `curl` against a running server.
4. **`GenerateModal`.** Description → Generate → preview → Regenerate / Add.
5. **Entry points + gating.** Toolbar button, empty-state link, `aiEnabled` plumbing.
6. **Verification.** Per CLAUDE.md, run the dev server and exercise: generate from a
   description, edit the draft, regenerate, add to guide, confirm it persists and
   shows in the list/meter, and confirm the button is gated with AI off.

Lands as its own commit(s) on `customize-styleguide` (or a `style-guide-generation`
branch off it).

---

## 8. v2+ sketch

- **Decomposition:** "split into sections" — same description, a meta-prompt that
  returns an array, and a multi-select preview ("keep voice + formatting, drop
  vocabulary"). Needs structured output and a list preview.
- **Refine existing:** pass a section's current body + an instruction
  ("tighten this", "make it British English") → a revised body, shown as a
  `DiffView` (composite already exists) before accept.
- **Lint pass:** a one-click "tidy" that runs any section through the meta-prompt's
  rules without changing intent.
- **Streaming** the body into the preview textarea.
- **Dedicated model key** (`styleGen`) if "default" proves too slow or too weak.

None of this requires schema changes — generation only ever produces section
`{ title, body }`, which the existing builder already stores.
