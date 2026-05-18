# Plan 03 — AI Fill-In Blocks

## Context

The diagram feature (see `diagramPlaceholder.tsx`, `diagramCommand.ts`, `DiagramPlugin.ts`) lets the user type `/diagram: description`, press Enter, and get a placeholder block that is replaced with generated content. This plan adds a similar but more powerful block: an **AI fill-in block** where the user types instructions inside the block itself, clicks a generate button, and the AI reads the full document (plus any `@mentioned` files) and fills in the block. Multiple fill blocks can be processed sequentially with a "Process all" command.

## Goals

1. New TipTap node extension: `AIFillBlock`.
2. Slash command `/fill` to insert it.
3. New WebSocket protocol messages: `ai_fill_request` / `ai_fill_result`.
4. New server handler that invokes the AI to generate fill content.
5. "Process all blocks" action (toolbar or slash command).
6. Support `@filename.md` mentions inside the instruction for additional context.

---

## Step 1 — New TipTap node extension

**New file:** `packages/app-episteme/src/components/editor/extensions/aiFillBlock.tsx`

The node has two states:
- **Idle** — shows an editable instruction textarea + a sparkle (✦) generate button.
- **Generating** — shows a spinner (like `DiagramPlaceholderView`).

Node schema:

```ts
Node.create({
  name: "aiFillBlock",
  group: "block",
  atom: false,   // NOT atom — we need editable content
  selectable: true,
  draggable: true,
  content: "inline*",  // stores the instruction text as inline content

  addAttributes() {
    return {
      id: { default: () => crypto.randomUUID() },
      generating: { default: false },
    };
  },
  // parseHTML, renderHTML, addNodeView ...
})
```

The node view (`ReactNodeViewRenderer`) renders:

```tsx
function AIFillBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const isGenerating = node.attrs.generating as boolean;
  const instruction = node.textContent;

  if (isGenerating) {
    return (
      <NodeViewWrapper className="ai-fill-block ai-fill-block--generating" contentEditable={false}>
        <Loader2 size={14} className="icon-spin" />
        <span>Generating…</span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="ai-fill-block">
      <span className="ai-fill-block-label">AI Fill</span>
      <NodeViewContent className="ai-fill-block-instruction" />
      <button
        className="ai-fill-block-btn"
        contentEditable={false}
        onClick={() => {
          // Trigger generation — call the callbackRef
          if (callbackRef.current) {
            updateAttributes({ generating: true });
            callbackRef.current(node.attrs.id as string, instruction);
          }
        }}
        title="Generate content"
      >
        <Sparkles size={12} />
      </button>
    </NodeViewWrapper>
  );
}
```

The `callbackRef` pattern is the same as `DiagramCommandExtension`: the node view gets a ref to a callback provided at extension-creation time, so the React component can trigger a parent action without prop drilling.

Export a factory function:

```ts
export function AIFillBlockExtension(
  callbackRef: React.MutableRefObject<
    ((id: string, instruction: string) => void) | undefined
  >,
) {
  return Node.create({ ... });
}
```

---

## Step 2 — Slash command to insert fill block

**File:** `packages/app-episteme/src/components/editor/SlashCommand.tsx`

Read this file to understand how slash commands are registered. Add a `/fill` or `/ai fill` entry that inserts an `aiFillBlock` node at the cursor.

The insert command:

```ts
editor.chain().focus().insertContent({ type: "aiFillBlock" }).run()
```

Match the style of existing slash command entries (icon, label, description).

---

## Step 3 — Protocol messages

**File:** `packages/app-episteme/src/protocol.ts`

Add to `ClientMsg`:

```ts
| { type: "ai_fill_request"; id: string; instruction: string; document: string; mentions: Array<{ path: string; content: string }> }
```

Add to `ServerMsg`:

```ts
| { type: "ai_fill_result"; id: string; content: string; error?: string }
```

Add both new types to the exhaustive switch in `useWebSocket.ts` (`dispatch` function) to keep it compiling.

---

## Step 4 — Server handler

Read `packages/app-episteme/src/server/index.ts` and `packages/app-episteme/src/server/handlers/editor.ts` to understand how the server dispatches client messages and calls the AI.

**New file:** `packages/app-episteme/src/server/handlers/aiFill.ts`

```ts
export async function handleAIFill(msg, ctx, ws): Promise<void> {
  // Build a prompt:
  //   "You are filling in a block in a document. The document is: <document>
  //    Additional referenced files: <mentions>
  //    The user's instruction for this block is: <instruction>
  //    Write ONLY the content for this block. Output raw markdown, no preamble."
  // Call the AI (same pattern as DiagramPlugin or other feature handlers).
  // On success: ws.send({ type: "ai_fill_result", id: msg.id, content })
  // On error: ws.send({ type: "ai_fill_result", id: msg.id, content: "", error: e.message })
}
```

Study `packages/app-episteme/src/plugins/DiagramPlugin.ts` as the reference for how to invoke the AI for a single-shot generation task.

Wire the handler into the server's message dispatch (wherever `diagram_request` is handled, add `ai_fill_request` beside it).

---

## Step 5 — Editor integration (callback + result handling)

**File:** `packages/app-episteme/src/components/editor/Editor.tsx`

Read this file to understand how `diagramRequest` is wired. Apply the same pattern for `aiFillBlock`:

1. Create a `aiFillCallbackRef` using `useRef`.
2. Pass it to `AIFillBlockExtension(aiFillCallbackRef)` when building the extensions array.
3. Assign `aiFillCallbackRef.current` to a function that:
   a. Parses `@filename.md` mentions from the instruction text.
   b. Fetches their content via `/api/file-content?path=...`.
   c. Sends `{ type: "ai_fill_request", id, instruction, document: currentContent, mentions }` over the WebSocket.

Add a prop: `onAIFillRequest?: (id: string, instruction: string) => void` to `EditorProps`, and wire it up through `App.tsx` to a handler in `useEditorFeatures.ts` (or directly in `App.tsx` — follow the diagram pattern).

For the result, subscribe to `ai_fill_result` in `useEditorFeatures.ts` (or wherever `diagram_result` is handled). When it arrives:
- Find the `aiFillBlock` node with matching `id` in the editor document.
- Replace it with the generated markdown content (parse it into TipTap nodes).
- If `error` is set, set `generating: false` on the node and show the error (a notification or an inline error state on the node view).

To find and replace a node by id:

```ts
editor.state.doc.descendants((node, pos) => {
  if (node.type.name === "aiFillBlock" && node.attrs.id === id) {
    const tr = editor.state.tr;
    const parsed = editor.schema.nodeFromJSON(/* parsed markdown content */);
    // or use: editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).insertContentAt(pos, parsedContent).run()
  }
});
```

Use TipTap's `generateJSON` or the existing markdown-to-JSON utility already used in the codebase for converting the returned markdown.

---

## Step 6 — "Process all blocks" command

This allows the user to trigger all fill blocks in the document sequentially.

**Option A — Slash command `/process fills`:** Adds an entry to `SlashCommand.tsx` that finds all `aiFillBlock` nodes and fires them one by one, waiting for each `ai_fill_result` before triggering the next.

**Option B — Toolbar button:** Add a button to `MarkdownToolbar.tsx` (read that file first) that does the same.

Implementation regardless of entry point:

```ts
async function processAllFillBlocks(editor: Editor) {
  const blocks: Array<{ id: string; instruction: string; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "aiFillBlock" && !node.attrs.generating) {
      blocks.push({ id: node.attrs.id, instruction: node.textContent, pos });
    }
  });

  for (const block of blocks) {
    // Set generating: true on this block
    // Send ai_fill_request
    // Await ai_fill_result for this id (wrap the subscribe in a Promise)
    // The document now contains the filled content — next iteration re-reads it
  }
}
```

To await a single result, create a one-shot subscriber:

```ts
function waitForFillResult(subscribe, id): Promise<string> {
  return new Promise((resolve, reject) => {
    const unsub = subscribe("ai_fill_result", (msg) => {
      if (msg.id !== id) return;
      unsub();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.content);
    });
  });
}
```

---

## Step 7 — CSS

**File:** `packages/app-episteme/src/styles.css`

Add styles for `.ai-fill-block`. Model it after `.diagram-generating` for the generating state, and give the idle state a distinctive dashed border or background to make it visually clear it is a fill block. Key classes:

- `.ai-fill-block` — border, padding, background tint
- `.ai-fill-block-label` — small, muted label "AI Fill" in the top-left corner
- `.ai-fill-block-btn` — the sparkle button, float right or absolute top-right
- `.ai-fill-block-instruction` — the editable text area portion
- `.ai-fill-block--generating` — spinner state, same visual as `.diagram-generating`

---

## Verification

- Type `/fill` in the editor, confirm the fill block is inserted.
- Type an instruction inside the block (e.g., "Write a one-paragraph introduction about this document").
- Click the sparkle button. Confirm the block enters generating state, the server receives the request with the document content, and the block is replaced with the AI's response.
- Type a fill block with `@somefile.md` in the instruction. Confirm that file's content is included in the request.
- Insert three fill blocks, click "Process all". Confirm they are filled in order.
- No TypeScript errors.
