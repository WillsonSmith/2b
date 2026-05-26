# Episteme Prompt Architecture Plan

## Context

Episteme is an AI-assisted Markdown text editor with research capabilities. Its agent is assembled from a base system prompt and per-plugin prompt fragments that are injected each turn. Some plugins are always-on; others are mode-gated (active only when the user enables them).

The goal of this plan is to produce a better, more maintainable prompt architecture — one where the base prompt owns identity and general principles, and each plugin owns its own activation guidance, vocabulary, and behavioral instructions.

**Key architectural principle established:** Plugins should be responsible for telling the agent when to use them. The base prompt should not reference specific plugins by name.

---

## Area 1: Base Prompt Identity and Output Style

**File:** `packages/app-episteme/src/agent.ts` — `SYSTEM_PROMPT` constant

### Current problems

- Identifies Episteme as a "research assistant," which primes the model toward academic output conventions: annotated headings, parenthetical glosses, numbered sections with sub-labels. Examples of unwanted output: `"The Trauma-Looping (The Availability of Terror)"`, `"3. The 'Backwards Echo' Theory"`, `"Architect Hubris (The Illusion of Mastery)"`.
- `"Prefer structured Markdown output when providing content"` is the wrong default. It causes headers and bullets even for simple conversational replies.
- `"Your primary context is the current workspace and its documents"` is restated more specifically by plugin fragments (EditorContextPlugin, WorkspacePlugin) — the base prompt version is redundant and vaguer.
- The four bullet roles (`Draft and refine`, `Research topics`, `Organize`, `Identify connections`) overlap with plugin fragment responsibilities without coordinating with them.

### Decisions

1. **Change the identity.** Episteme is a text editor with research capability — not a research tool that also edits. Writing quality is the default posture; research is a mode you invoke.
2. **Remove the flat output style rule.** Replace with a mode-aware rule: prose for conversational replies, Markdown structure only for explicitly synthesized content (summaries, outlines, research outputs). The editing-specific style guidance moves to EditorContextPlugin (see Area 2).
3. **Defer to the active style guide.** The base prompt should state that if a style guide is active, it takes precedence for voice and formatting. The StyleGuidePlugin fragment will carry the specifics.
4. **Remove plugin-specific role bullets.** These belong in the plugin fragments. The base prompt should describe Episteme's identity and general behavioral principles only.

### Rewrite target

The new base prompt should be short. It should establish:
- What Episteme is (text editor with research capability)
- Its behavioral default (write naturally and precisely in the user's register)
- The style guide deference rule
- The principle of reading injected context before reaching for tools

---

## Area 2: Plugin Activation Guidance

Each always-on plugin's `getSystemPromptFragment()` should own its "when to use me" guidance. Currently most fragments are either missing this or describe capabilities without positioning them relative to each other.

### 2a. WorkspacePlugin

**File:** `packages/app-episteme/src/plugins/WorkspacePlugin.ts`

**Current fragment (abbreviated):** `"You have access to a Markdown workspace at: /path (N files indexed). Use workspace tools to index, search, and read files."`

**Missing:**
- Priority hint: search the workspace before going to the web
- Link model: files are connected by standard Markdown links, not wikilinks (see Area 5)
- Link syntax instruction: when inserting links between workspace files, use `[display text](./relative/path.md)` — paths must be relative to the file being edited, not the workspace root

**Decision:** Add these three elements to the fragment. The fragment already owns workspace navigation; it should also own the link model and priority position.

### 2b. ResearchPlugin

**File:** `packages/app-episteme/src/plugins/ResearchPlugin.ts`

**Current fragment:** Needs inspection — confirm it describes activation conditions.

**Decision:** The fragment should include: "Use research tools when the workspace does not contain sufficient information on the topic." This positions ResearchPlugin below WorkspacePlugin in the priority ladder without the base prompt needing to name either.

### 2c. PlanningPlugin

**File:** `packages/app-episteme/src/plugins/PlanningPlugin.ts`

**Current behavior:** `getSystemPromptFragment()` only fires when a plan is actively executing. There is no always-on guidance about when to propose a plan.

**Decision:** Split the fragment into two parts:
- **Always-on static section:** "For multi-step or research-heavy tasks, offer to create a plan before proceeding. Plans allow progress to be tracked and recovered across interruptions."
- **Execution-time dynamic section:** The existing context showing the active plan, current step, and completed steps. This fires only when `activePlan` is executing.

### 2d. EditorContextPlugin

**File:** `packages/app-episteme/src/plugins/EditorContextPlugin.ts`

**Current fragment:** `"The user is currently editing a Markdown document. Its content is injected into your context each turn. When answering, take the current document into account."`

**Missing:** Editing-mode output style guidance.

**Decision:** Add: "When generating or inserting content into the active document, match the heading depth, formatting style, and voice of the surrounding text. Do not add parenthetical annotations to headings or impose structural conventions not already present in the document."

---

## Area 3: Mode-Gated Inactive Hints

**Files:**
- Plugin interface: `packages/framework/src/core/Plugin.ts`
- ModeGated wrapper: `packages/app-episteme/src/agent.ts`
- Mode-gated plugins: `CitationPlugin.ts`, `StyleGuidePlugin.ts`, `DiagramPlugin.ts`, `ContradictionPlugin.ts` (all in `packages/app-episteme/src/plugins/`)

### Current problem

When a mode-gated plugin is inactive, its fragment is suppressed entirely. The model has no awareness that the capability exists. If a user asks for something a plugin provides (e.g., citation checking), the model either improvises or says it can't help — with no ability to say "enable Citation mode."

### Decision

**Add an optional `getInactiveHint(): string` method to the `AgentPlugin` interface.**

The `ModeGated` wrapper already controls which fragment version is injected. Modify it to:
- When **active** → delegate `getSystemPromptFragment()` as today (full fragment)
- When **inactive** → delegate `getInactiveHint()` instead (slim hint)

Each mode-gated plugin implements both methods. The inactive hint contains two elements:
1. What the capability is (one line)
2. A heuristic for when it should be activated (one line)

**Example hints:**

- **Citation:** `"Citation tools are available but inactive. Enable them when the user is working with sources, bibliographies, or wants to verify references."`
- **StyleGuide:** `"Style guide enforcement is available but inactive. Enable it when the user wants consistent voice, tone, or formatting applied across their writing."`
- **Diagram:** `"Diagram generation is available but inactive. Enable it when the user wants to create Mermaid.js diagrams from natural language descriptions."`
- **Contradiction:** `"Contradiction scanning is available but inactive. Enable it when the user wants to identify conflicting claims across their workspace notes."`

This mechanism is self-scaling: new mode-gated plugins automatically register their heuristic without any changes to the base prompt.

---

## Area 4: Vocabulary Consistency

### Problem

Plugin fragments use inconsistent terminology for the same things, creating low-grade confusion when the model assembles the full prompt.

### Decision

Adopt a shared vocabulary across all fragment strings:

| Concept | Canonical term |
|---------|---------------|
| The file open in the editor | "the active document" |
| All files in the workspace | "the workspace" |
| The chat/conversation panel | "the chat" |
| A file's path in the workspace | "workspace-relative path" |

Apply these terms when writing or rewriting any fragment in any plugin.

---

## Area 5: Wikilink → Standard Markdown Link Migration

This is a code change with prompt implications, identified during the prompt discussion.

**Decision:** Remove all `[[wikilink]]` syntax support. Use only standard Markdown links: `[display text](./relative/path.md)`. Links must be relative to the file they are linked from.

### Files to delete (fully orphaned — nothing imports them)

- `packages/app-episteme/src/features/wikilinks.ts`
- `packages/app-episteme/src/components/editor/extensions/wikilinks.ts`
- `packages/app-episteme/src/components/editor/SlashCommand.tsx`

### Files to edit

| File | Change |
|------|--------|
| `packages/app-episteme/src/components/editor/Editor.tsx` | Remove the `[[wikilink]]` unescape hack in `getMarkdown()` (lines 49–54); simplify to a direct `getMarkdown` call |
| `packages/app-episteme/src/plugins/WorkspacePlugin.ts` | Remove `findWikilinks`/`resolveWikilinkTarget` import; remove wikilink loop from `extractLinksForFile`; add `sourcePath: string` param; replace broken `resolveWikilinkTarget` call in the markdown loop with `resolveLocalHref(href, sourcePath, allFiles)` from `../features/links.ts` |
| `packages/app-episteme/src/db/workspaceDb.ts` | Change `linkType: "wikilink" \| "markdown"` to `linkType: "markdown"` (two spots: line 32 type definition, line 923 cast) |
| `packages/app-episteme/src/ssg/render.ts` | Remove `WIKILINK_RE`/`resolveWikilinkTarget` import; remove legacy wikilink block from `extractEdgesForFile`; remove `resolveWikilinksInBody` function |
| `packages/app-episteme/src/ssg/generate.ts` | Remove `resolveWikilinksInBody` import and call (line 101); pass `processedBody` directly to `marked.parse`; rename class `wikilink-broken` → `link-broken` in the broken link renderer (line 39) |
| `packages/app-episteme/src/ssg/assets.ts` | Rename `.wikilink-broken` CSS selector → `.link-broken` |

### Tests to update

| File | Change |
|------|--------|
| `packages/app-episteme/src/plugins/WorkspacePlugin.test.ts` | Replace wikilink content (`[[...]]`) in test fixtures with standard Markdown links; update describe block names; change `linkType: "wikilink"` assertion to `"markdown"` |
| `packages/app-episteme/src/db/workspaceDb.test.ts` | Change all `linkType: "wikilink"` to `linkType: "markdown"` |

### Existing utilities (already correct — no changes needed)

`packages/app-episteme/src/features/links.ts` already contains the correct implementations:
- `resolveLocalHref(href, currentFilePath, allFiles)` — resolves a relative href against the workspace file list
- `computeRelativeHref(fromFile, toFile)` — computes the relative href between two workspace files
- `rankFilesForLink(files, query, limit)` — ranks files for link autocomplete

The Meta+K link picker in `Editor.tsx` already uses these correctly.

---

## Area 6: Style Guide Assembly Feature (Future)

**File:** `packages/app-episteme/src/plugins/StyleGuidePlugin.ts`

### Context

The long-term solution for output style control is a composable style guide system, rather than style rules in the base prompt. This allows users to define their desired output style without any prompt engineering.

### Planned capability

- **Preset blocks:** predefined style guide fragments (e.g., "journalistic prose," "plain academic," "conversational") that users can activate
- **Custom blocks:** user-defined style rules that can be composed with presets
- **Assembly UI:** a way to combine preset and custom blocks into an active style guide

### Prompt architecture implication

Once this exists, the base prompt only needs: "If a style guide is active, follow it for voice, tone, and formatting." The StyleGuidePlugin fragment carries the specifics. The base prompt stays stable regardless of what style rules are loaded.

This feature is not a prerequisite for the prompt changes in Areas 1–4, but should be designed with the prompt architecture in mind.

---

## Summary of Changes by File

| File | Type | Area |
|------|------|------|
| `src/agent.ts` — `SYSTEM_PROMPT` | Rewrite | 1 |
| `src/agent.ts` — `ModeGated` class | Add inactive hint delegation | 3 |
| `packages/framework/src/core/Plugin.ts` | Add optional `getInactiveHint()` | 3 |
| `src/plugins/EditorContextPlugin.ts` | Add editing-mode style guidance to fragment | 2d |
| `src/plugins/WorkspacePlugin.ts` | Add priority/link-model guidance + wikilink removal | 2a, 5 |
| `src/plugins/ResearchPlugin.ts` | Add activation condition to fragment | 2b |
| `src/plugins/PlanningPlugin.ts` | Split fragment into always-on + execution-time | 2c |
| `src/plugins/CitationPlugin.ts` | Add `getInactiveHint()` | 3 |
| `src/plugins/StyleGuidePlugin.ts` | Add `getInactiveHint()` | 3 |
| `src/plugins/DiagramPlugin.ts` | Add `getInactiveHint()` | 3 |
| `src/plugins/ContradictionPlugin.ts` | Add `getInactiveHint()` | 3 |
| `src/features/wikilinks.ts` | Delete | 5 |
| `src/components/editor/extensions/wikilinks.ts` | Delete | 5 |
| `src/components/editor/SlashCommand.tsx` | Delete | 5 |
| `src/components/editor/Editor.tsx` | Remove wikilink unescape | 5 |
| `src/db/workspaceDb.ts` | Remove `"wikilink"` from linkType | 5 |
| `src/ssg/render.ts` | Remove wikilink functions | 5 |
| `src/ssg/generate.ts` | Remove wikilink call, rename CSS class | 5 |
| `src/ssg/assets.ts` | Rename `.wikilink-broken` | 5 |
| `src/plugins/WorkspacePlugin.test.ts` | Update wikilink fixtures | 5 |
| `src/db/workspaceDb.test.ts` | Update linkType assertions | 5 |
