# Plan 02 — Simplified Bubble Menu + Send to Chat

## Context

`packages/app-episteme/src/components/editor/BubbleMenu.tsx` currently shows these buttons when text is selected: Link, Unlink, Professional, Casual, Academic, TL;DR, Table, Ask AI.

The user wants to remove all AI operations from this popup. Only Link/Unlink formatting remains. The AI operations are replaced by a single **"Send to Chat"** button that pre-populates the AISidecar chat input with a reference to the selected text (`@filename.md[line N–M]`) so the user can type their own instruction before sending — rather than executing immediately.

## Goals

1. Strip Professional, Casual, Academic, TL;DR, Table, and Ask AI from `BubbleMenu.tsx`.
2. Add a "Send to Chat" button that pre-populates the sidecar input with a text reference.
3. Give `ChatInput` an external seed mechanism.
4. Wire everything in `App.tsx` and `Editor.tsx`.

---

## Step 1 — Simplify BubbleMenu.tsx

**File:** `packages/app-episteme/src/components/editor/BubbleMenu.tsx`

Remove from props interface:
- `onToneRequest`
- `onSummarizeRequest`
- `onTableRequest`
- `onAskAboutSelection`

Remove from the JSX:
- All three tone buttons (Professional, Casual, Academic) and their separator.
- The TL;DR button and its separator.
- The Table button.
- The Ask AI button and its separator.

Add to props interface:
```ts
onSendToChat?: (selectionRef: string) => void;
currentFilePath?: string;
```

Add a helper at the top of the file to compute the line range for a selection:

```ts
function getLineRange(doc: Editor["state"]["doc"], from: number, to: number): { start: number; end: number } {
  const textBefore = doc.textBetween(0, from, "\n");
  const startLine = textBefore.split("\n").length;
  const textRange = doc.textBetween(from, to, "\n");
  const lineCount = textRange.split("\n").length;
  return { start: startLine, end: startLine + lineCount - 1 };
}
```

Add the "Send to Chat" button after the Link/Unlink section:

```tsx
{onSendToChat && (
  <>
    <div className="bubble-sep" />
    <button
      className="bubble-btn"
      title="Send selection to AI chat"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const { from, to } = editor.state.selection;
        const { start, end } = getLineRange(editor.state.doc, from, to);
        const filename = currentFilePath?.split("/").at(-1) ?? "document";
        const ref = start === end
          ? `@${filename}[line ${start}]`
          : `@${filename}[lines ${start}–${end}]`;
        onSendToChat(ref);
      }}
    >
      Ask AI
    </button>
  </>
)}
```

The final button list is: Link, (Unlink if active), separator, Ask AI (which now seeds chat instead of sending).

---

## Step 2 — Remove unused props from Editor.tsx

**File:** `packages/app-episteme/src/components/editor/Editor.tsx`

Read this file to find where `EditorBubbleMenu` is used. Remove the props no longer accepted:
- `onToneRequest`
- `onSummarizeRequest`
- `onTableRequest`
- `onAskAboutSelection`

Add the new ones:
- `onSendToChat`
- `currentFilePath` (already passed as a prop to Editor — check if it's already threaded)

Update the `EditorProps` interface accordingly and pass the new props through to `EditorBubbleMenu`.

Note: The underlying features (`handleToneRequest`, `handleSummarizeRequest`, `handleTableRequest`) should be **left in place** in `useEditorFeatures.ts` and `App.tsx` — they may be used by slash commands or other entry points. Only the bubble menu wiring is removed.

---

## Step 3 — Seed the ChatInput externally

**File:** `packages/app-episteme/src/components/AISidecar.tsx`

Add a `pendingInput?: string` prop to both `AISidecarProps` and `ChatInputProps`.

In `ChatInput`, add a `useEffect` that watches `pendingInput` and sets the input state when it is non-empty:

```ts
useEffect(() => {
  if (pendingInput) {
    setInput(pendingInput + " ");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }
}, [pendingInput]);
```

Pass `pendingInput` from `AISidecar` down to `ChatInput`.

---

## Step 4 — Wire in App.tsx

**File:** `packages/app-episteme/src/App.tsx`

1. Add state: `const [sidecarPendingInput, setSidecarPendingInput] = useState("");`

2. Replace the `handleAskAboutSelection` callback with `handleSendToChat`:

```ts
const handleSendToChat = useCallback((selectionRef: string) => {
  setSidecarPendingInput(selectionRef);
  setSidecarCollapsed(false);
}, []);
```

3. After the sidecar consumes the pending input (i.e., when the user actually sends), clear it. The cleanest way: pass an `onPendingInputConsumed` callback to `AISidecar` → `ChatInput`. Inside `ChatInput.submit()`, after clearing input, call it:

```ts
function submit() {
  const text = input.trim();
  if (!text || isThinking) return;
  onSend(text);
  setInput("");
  onPendingInputConsumed?.();
  closeMention();
}
```

Add `onPendingInputConsumed?: () => void` to `AISidecarProps` and `ChatInputProps`, wire it in `App.tsx` as `() => setSidecarPendingInput("")`.

4. Update the `Editor` component usage in `App.tsx` JSX:
   - Remove `onToneRequest`, `onSummarizeRequest`, `onTableRequest`, `onAskAboutSelection` props.
   - Add `onSendToChat={handleSendToChat}`.

5. Update the `AISidecar` component usage:
   - Add `pendingInput={sidecarPendingInput}`.
   - Add `onPendingInputConsumed={() => setSidecarPendingInput("")}`.

---

## Step 5 — Clean up App.tsx dead code

After removing the bubble menu AI ops, these items in `App.tsx` may now be unused (verify before deleting):
- `handleAskAboutSelection` (replaced by `handleSendToChat`)
- Any `onToneRequest` / `onSummarizeRequest` / `onTableRequest` pass-throughs to `Editor` that are now disconnected from the bubble menu

Check whether `editorFeatures.handleToneRequest` etc. are still wired to other Editor paths (e.g., slash commands). If they are, keep the hooks but don't pass them to the Editor bubble menu path. If nothing else uses them, they can be left as dead code for now — do not delete feature logic until confirmed unused everywhere.

---

## Verification

- Select text in the editor. Confirm the bubble menu shows only Link (and Unlink if on a link) and "Ask AI".
- Click "Ask AI". Confirm the sidecar opens, the chat input is pre-populated with `@filename[line N]` (or `lines N–M` for multi-line), and the cursor is placed at the end ready to type.
- Type additional text and send. Confirm it sends correctly.
- Confirm no TypeScript errors.
