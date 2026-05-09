# Diagram Feature

Episteme supports inline Mermaid.js diagrams generated from natural language. The user types a slash command in the editor, the description is sent to an LLM sub-agent that returns raw Mermaid syntax, and the result is inserted as a rendered, pannable, zoomable diagram block.

---

## Files

| File | Layer | Role |
|------|-------|------|
| `src/apps/episteme/plugins/DiagramPlugin.ts` | Server | LLM sub-agent that converts a description into Mermaid syntax |
| `src/apps/episteme/server/handlers/editor.ts` | Server | WebSocket message handler; dispatches `diagram_request` to the plugin |
| `src/apps/episteme/agent.ts` | Server | Registers `DiagramPlugin` with the main Episteme agent |
| `src/apps/episteme/hooks/useEditorFeatures.ts` | Client | Sends `diagram_request` over WebSocket; receives `diagram_result` and updates React state |
| `src/apps/episteme/components/editor/Editor.tsx` | Client | Wires the diagram callback ref; inserts the mermaid code block into the document on result |
| `src/apps/episteme/components/editor/extensions/diagramCommand.ts` | Client | TipTap extension: intercepts Enter when the current line matches `/diagram` |
| `src/apps/episteme/components/editor/extensions/mermaid.tsx` | Client | TipTap extension + React NodeView: renders mermaid blocks with pan/zoom and collapsible source |
| `src/apps/episteme/styles/editor.css` | Client | CSS for the diagram viewport, pan/zoom container, footer, and source panel |

---

## End-to-end data flow

```
User types "/diagram <description>" and presses Enter
         │
         ▼
DiagramCommandExtension (addKeyboardShortcuts → Enter)
  - Reads the current line from the ProseMirror document
  - Matches /^\/diagram:?\s+(.+)/i
  - Extracts: description (string), lineStart (int), from (int)
  - Calls onDiagramRequest(description, lineStart, from)
  - Returns true → suppresses TipTap's default newline
         │
         ▼
useEditorFeatures.handleDiagramRequest
  - Sends WebSocket message: { type: "diagram_request", description, from, to }
         │
         ▼ (WebSocket → server)
handleEditor (server/handlers/editor.ts) — case "diagram_request"
  - Calls diagram.generate(description)
         │
         ▼
DiagramPlugin.generate(description)
  - Calls HeadlessAgent.ask(description) with focused Mermaid system prompt
  - Strips any code fences the LLM may have included (```mermaid / ```)
  - Returns raw Mermaid syntax string
         │
         ▼
handleEditor sends WebSocket message: { type: "diagram_result", code, from, to }
         │
         ▼ (WebSocket → client)
useEditorFeatures subscribe("diagram_result")
  - Sets diagramResult state: { code, from, to }
         │
         ▼
Editor.tsx useEffect on diagramResult
  - Builds replacement: "```mermaid\n" + code + "\n```"
  - Calls editor.chain().focus().insertContentAt({ from, to }, replacement).run()
  - This replaces the "/diagram ..." line with a mermaid code block node
  - Calls onDiagramApplied() to clear diagramResult state
         │
         ▼
TipTap parses the inserted markdown via tiptap-markdown
  - Produces a codeBlock node with attrs: { language: "mermaid" }
         │
         ▼
MermaidCodeBlock NodeView (MermaidNodeView React component)
  - Detects language === "mermaid"
  - Calls mermaid.render(id, code) → returns SVG string
  - Renders: [diagram viewport] [footer/toggle] [collapsible source]
```

---

## Server-side: DiagramPlugin

**Location:** `src/apps/episteme/plugins/DiagramPlugin.ts`

The plugin implements the `AgentPlugin` interface. It owns a lazily-initialised `HeadlessAgent` whose sole job is Mermaid generation.

### System prompt

```
You are a Mermaid.js diagram generator. Convert the user's description into a valid Mermaid.js diagram.
Return ONLY the raw Mermaid syntax — no code fences, no explanation, no preamble.
Default to flowchart LR unless another type is clearly more appropriate (sequenceDiagram, gantt, pie, classDiagram, etc.).
```

### Code fence stripping

LLMs often return fenced output despite instructions. `generate()` defensively strips any wrapping before returning:

```ts
raw.trim()
  .replace(/^```(?:mermaid)?\s*\n?/, "")
  .replace(/\n?```\s*$/, "")
  .trim()
```

### Tool registration

`DiagramPlugin` also exposes a `generate_diagram` tool so the main Episteme agent can invoke diagram generation via tool call (not just the slash command path). The tool takes a single `description: string` parameter and returns the raw Mermaid syntax. This means the agent can proactively insert diagrams during a chat response if appropriate.

### Model

Uses `featureModel(config, "default")` — the same model tier as other lightweight feature sub-agents (tone, summarize, etc.), not necessarily the same model as the main Episteme agent.

---

## Client-side: DiagramCommandExtension

**Location:** `src/apps/episteme/components/editor/extensions/diagramCommand.ts`

A TipTap `Extension` (not a Node) that hooks into the ProseMirror keyboard pipeline.

### Why a TipTap extension rather than a DOM listener

Adding a native `addEventListener("keydown")` to `editor.view.dom` fires *after* ProseMirror has already committed the keypress (newline already inserted). Using `addKeyboardShortcuts()` runs inside ProseMirror's event chain — returning `true` genuinely suppresses the default behaviour.

### Trigger format

Accepts both `/diagram: description` and `/diagram description` (colon optional, case-insensitive):

```
/^\/diagram:?\s+(.+)/i
```

The match must be at the start of the current line and the selection must be collapsed (no text selected).

### Callback wiring

The extension receives a `React.MutableRefObject` containing the `onDiagramRequest` callback. Using a ref (updated each render in `Editor.tsx`) avoids stale closure issues without recreating the extension on every render:

```ts
// Editor.tsx
const diagramCallbackRef = useRef<...>(undefined);
diagramCallbackRef.current = onDiagramRequest;

// passed once at editor init:
DiagramCommandExtension(diagramCallbackRef)
```

---

## Client-side: MermaidCodeBlock

**Location:** `src/apps/episteme/components/editor/extensions/mermaid.tsx`

Extends `CodeBlock` from `@tiptap/extension-code-block` with a React `NodeViewRenderer`. Because it keeps the node name `"codeBlock"`, `tiptap-markdown` continues to parse and serialise all code fences correctly — mermaid blocks round-trip as ` ```mermaid ` in the stored markdown file.

`StarterKit` is configured with `codeBlock: false` in `Editor.tsx` to disable the default CodeBlock, then `MermaidCodeBlock` is added as a replacement. Non-mermaid code blocks (language is anything other than `"mermaid"`) fall through to the standard `<pre><code>` rendering path inside the same NodeView.

### MermaidNodeView (React component)

Renders the following structure for `language === "mermaid"`:

```
NodeViewWrapper.mermaid-block
  ├── MermaidDiagram          (only when svg rendered successfully)
  ├── div.mermaid-footer      (always visible, contentEditable=false)
  │     └── button.mermaid-toggle  ("Show source" / "Hide source")
  └── pre.mermaid-source      (visible when showSource=true OR no diagram)
        └── NodeViewContent   (ProseMirror-managed editable content)
```

**State:**
- `svg: string` — rendered SVG string from `mermaid.render()`; empty while loading
- `errored: boolean` — set on render failure
- `showSource: boolean` — controls source panel visibility; defaults to `false`

**Source panel fallback:** When `hasDiagram` is false (still loading or errored), the source pre is forced visible regardless of `showSource`. This ensures content is never completely hidden.

**Re-render:** The `useEffect` depends on `[language, code]`. Whenever the user edits the source (via the visible source panel), `code` changes → mermaid re-renders → SVG updates.

**Mermaid initialisation:** `mermaid.initialize()` is called once via a module-level flag (`mermaidReady`). It is not called on each component mount.

### MermaidDiagram (React component)

The pan/zoom viewport. Receives the pre-rendered `svg` string as a prop.

**DOM structure:**
```
div.mermaid-diagram          (fixed 320px height, overflow: hidden)
  ├── div.mermaid-diagram-inner   (position: absolute; inset: 0; flexbox centred)
  │     └── div                  (receives CSS transform for pan + zoom)
  │           └── [SVG markup]
  └── button.mermaid-reset        (⊙, positioned bottom-right)
```

**Pan:** `mousedown` captures the start position and a snapshot of the current pan offset (`panStart` ref). `mousemove` computes the delta and updates `pan` state. `mouseup` and `mouseleave` stop the drag. Pan state resets to `{0, 0}` on reset.

**Zoom:** A native `wheel` event listener is registered with `{ passive: false }` so `preventDefault()` is respected by the browser — this blocks page scroll while the cursor is over the diagram. The React synthetic `onWheel` prop cannot do this because React registers wheel listeners as passive. Scale is clamped to `[0.2, 8]`.

**Transform:** Both pan and zoom are applied as a single CSS transform on the inner content div:
```
transform: translate(Xpx, Ypx) scale(S)
transform-origin: center center
```
The outer `mermaid-diagram-inner` div uses flexbox to centre the SVG at rest, so `pan={0,0}` and `scale=1` always produce a centred view. The reset button restores exactly this state.

---

## CSS

**Location:** `src/apps/episteme/styles/editor.css`

All mermaid selectors are scoped under `.tiptap` to avoid leaking outside the editor.

| Selector | Purpose |
|----------|---------|
| `.tiptap .mermaid-block` | Outer wrapper; sets `margin-bottom` |
| `.tiptap .mermaid-diagram` | Fixed-height pan/zoom viewport; `overflow: hidden`; grab cursor |
| `.tiptap .mermaid-diagram:active` | Switches cursor to `grabbing` during drag |
| `.tiptap .mermaid-diagram-inner` | `position: absolute; inset: 0`; flexbox centres the SVG |
| `.tiptap .mermaid-diagram-inner svg` | `display: block` removes inline baseline gap |
| `.tiptap .mermaid-reset` | Absolutely positioned reset button (bottom-right) |
| `.tiptap .mermaid-footer` | Thin bar between diagram and source; holds the toggle button |
| `.tiptap .mermaid-toggle` | Unstyled button; small muted text |
| `.tiptap .mermaid-source` | The `<pre>` code panel; `text-align: left`; top border removed to join footer |
| `.tiptap .mermaid-block > .mermaid-source:first-child` | Restores full border-radius when there is no diagram above |
| `.tiptap .mermaid-source--error` | Red border when `mermaid.render()` throws |

---

## Known constraints and extension points

**Diagram viewport height is fixed at 320px.** It is set in CSS on `.tiptap .mermaid-diagram`. To make it resizable, the height would need to be driven by state in `MermaidDiagram` with a resize handle element.

**Zoom is centred on the diagram's initial centre, not the cursor position.** To zoom toward the cursor (like most map interfaces), the pan offset must be adjusted during each wheel event based on the cursor's position relative to the container. The formula is:
```
newPan.x = cursor.x - (cursor.x - pan.x) * (newScale / oldScale)
newPan.y = cursor.y - (cursor.y - pan.y) * (newScale / oldScale)
```

**Mermaid theme is hardcoded to `"default"`.** The `ensureMermaid()` function passes `{ theme: "default" }`. To support dark mode, pass `theme: "dark"` (or `"base"` with `themeVariables`) and re-initialise when the app theme changes. Note that `mermaid.initialize()` is currently only called once.

**The LLM model for diagram generation** is `featureModel(config, "default")`. To use a different model, change the key passed to `featureModel` or add a dedicated `"diagram"` model entry to `EpistemeConfig`.

**The `generate_diagram` tool** is available to the main Episteme agent via the plugin's `getTools()` / `executeTool()` methods. The agent can therefore insert a diagram autonomously during chat — the caller receives raw Mermaid syntax as a tool result string, which is then up to the chat handler to format and insert.
