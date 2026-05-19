# Plan 03 — Remove a File Reference from a Message

## Instructions for Claude

Before writing any code, evaluate every proposed change against the existing codebase patterns. Check that the implementation matches the style, error handling, and conventions already present in the files being modified. Pay particular attention to how the existing callback prop chain is structured in `AISidecar.tsx` — new callbacks must follow the same stable-ref pattern already used there. Only proceed once you are confident the changes are high quality and consistent with the surrounding code.

---

## Goal

Add a remove button (×) on each `FileMentionChip` that strips that specific `@mention` token from the stored message text without deleting the whole message. If removing the mention leaves the message empty, the whole message is deleted instead.

---

## Background

This plan depends on Plans 01 and 02 being implemented first. After Plan 01, `chat_messages` stores the compact `@mention` form. After Plan 02, those mentions render as collapsible chips in the message footer.

The existing delete flow removes an entire message via `DELETE /api/chat-history/:id` and `workspaceDb.deleteChatMessage`. The new operation is a partial edit: strip one `@filename.md` token from the stored text. This requires a new `PATCH /api/chat-history/:id` endpoint, a new `updateChatMessage` method on `WorkspaceDb`, a new `onRemoveMention` callback in `App.tsx`, and threading that callback through the `AISidecar` → `MessageList` → `FileMentionChip` prop chain.

---

## Files to Modify

- `packages/app-episteme/src/db/workspaceDb.ts`
- `packages/app-episteme/src/server/index.ts`
- `packages/app-episteme/src/App.tsx`
- `packages/app-episteme/src/components/AISidecar.tsx`

---

## Relevant Existing Code

### `workspaceDb.ts`

Prepared statement field declarations (around line 183):

```typescript
private stmtDeleteChatMessage!: ReturnType<Database["prepare"]>;
```

In `prepareStatements` (lines 490–493):

```typescript
this.stmtDeleteChatMessage = this.db.prepare(
  "DELETE FROM chat_messages WHERE id = ?",
);
```

Public method (lines 715–716):

```typescript
deleteChatMessage(id: number): void {
  this.stmtDeleteChatMessage.run(id);
}
```

### `server/index.ts`

Existing `/api/chat-history/:id` route (lines 350–357):

```typescript
"/api/chat-history/:id": {
  DELETE: (req: Request) => {
    const id = parseInt((req as Request & { params: Record<string, string> }).params.id, 10);
    if (isNaN(id)) return json({ error: "Invalid id" }, 400);
    workspaceDb.deleteChatMessage(id);
    return json({ ok: true });
  },
},
```

### `App.tsx`

`onDeleteMessage` (lines 373–381):

```typescript
const onDeleteMessage = useCallback((index: number) => {
  setMessages((prev) => {
    const msg = prev[index];
    if (msg && (msg.role === "user" || msg.role === "assistant") && msg.id !== undefined) {
      fetch(`/api/chat-history/${msg.id}`, { method: "DELETE" }).catch(() => {});
    }
    return prev.filter((_, i) => i !== index);
  });
}, []);
```

### `AISidecar.tsx`

`SidecarMessage` user variant (line 11):

```typescript
| { role: "user"; text: string; id?: number }
```

`MessageListProps` (lines 169–177):

```typescript
interface MessageListProps {
  messages: SidecarMessage[];
  isThinking: boolean;
  endRef: React.MutableRefObject<HTMLDivElement | null>;
  onNavigate?: (path: string) => void;
  onRegenerate?: (assistantIndex: number) => void;
  onSendToPlan?: (text: string) => void;
  onDeleteMessage?: (index: number) => void;
}
```

Stable-ref callback pattern used for existing callbacks (lines 645–662) — **new callbacks must follow this exact pattern**:

```typescript
const onDeleteMessageRef = useRef(onDeleteMessage);
onDeleteMessageRef.current = onDeleteMessage;

const stableDeleteMessage = useCallback((idx: number) => onDeleteMessageRef.current?.(idx), []);
```

---

## Implementation Steps

### 1. `workspaceDb.ts` — add `updateChatMessage`

Add a prepared statement field alongside `stmtDeleteChatMessage`:

```typescript
private stmtUpdateChatMessage!: ReturnType<Database["prepare"]>;
```

In `prepareStatements`, add after `stmtDeleteChatMessage`:

```typescript
this.stmtUpdateChatMessage = this.db.prepare(
  "UPDATE chat_messages SET text = ? WHERE id = ?",
);
```

Add the public method alongside `deleteChatMessage`:

```typescript
updateChatMessage(id: number, text: string): void {
  this.stmtUpdateChatMessage.run(text, id);
}
```

### 2. `server/index.ts` — add PATCH to the existing route

Extend the `/api/chat-history/:id` route object to include a `PATCH` handler alongside the existing `DELETE`:

```typescript
PATCH: async (req: Request) => {
  const id = parseInt((req as Request & { params: Record<string, string> }).params.id, 10);
  if (isNaN(id)) return json({ error: "Invalid id" }, 400);
  const body = (await req.json()) as { text?: string };
  if (typeof body.text !== "string") return json({ error: "text required" }, 400);
  const trimmed = body.text.trim();
  if (!trimmed) {
    workspaceDb.deleteChatMessage(id);
  } else {
    workspaceDb.updateChatMessage(id, trimmed);
  }
  return json({ ok: true });
},
```

If the resulting text is empty after stripping the mention, delete the message row entirely rather than storing a blank row.

### 3. `App.tsx` — add `onRemoveMention`

Add alongside `onDeleteMessage`:

```typescript
const onRemoveMention = useCallback((index: number, path: string) => {
  setMessages((prev) => {
    const msg = prev[index];
    if (!msg || msg.role !== "user") return prev;
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const newText = msg.text.replace(new RegExp(`\\s*@${escaped}`, "g"), "").trim();
    if (msg.id !== undefined) {
      fetch(`/api/chat-history/${msg.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: newText }),
      }).catch(() => {});
    }
    if (!newText) return prev.filter((_, i) => i !== index);
    const next = [...prev];
    next[index] = { ...msg, text: newText };
    return next;
  });
}, []);
```

Pass `onRemoveMention` to `AISidecar` alongside `onDeleteMessage`.

### 4. `AISidecar.tsx` — thread the callback through the prop chain

**`AISidecarProps`** — add:

```typescript
onRemoveMention?: (index: number, path: string) => void;
```

**Stable-ref pattern** in the `AISidecar` component body, following the existing pattern for `onDeleteMessage`:

```typescript
const onRemoveMentionRef = useRef(onRemoveMention);
onRemoveMentionRef.current = onRemoveMention;

const stableRemoveMention = useCallback(
  (idx: number, path: string) => onRemoveMentionRef.current?.(idx, path),
  [],
);
```

**`MessageListProps`** — add:

```typescript
onRemoveMention?: (index: number, path: string) => void;
```

Pass `stableRemoveMention` as `onRemoveMention` in both `MessageList` usages inside `AISidecar` (the inline panel and the `ChatModal`). Add the prop to `ChatModal`'s props interface and pass it through identically.

**`FileMentionChipProps`** — add `onRemove?: () => void`.

In the user message render block, bind the index when passing to the chip:

```tsx
{mentions.map((p) => (
  <FileMentionChip
    key={p}
    path={p}
    onRemove={onRemoveMention ? () => onRemoveMention(i, p) : undefined}
  />
))}
```

**`FileMentionChip`** — add the remove button inside the `<summary>`, using the `X` icon already imported in the file:

```tsx
<summary className="sidecar-mention-chip-summary">
  <span className="sidecar-mention-chip-name">@{short}</span>
  {onRemove && (
    <button
      className="sidecar-mention-chip-remove"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
      title="Remove reference"
    >
      <X size={9} />
    </button>
  )}
</summary>
```

Add `.sidecar-mention-chip-remove` to `styles.css`, styled to match `.sidecar-delete-btn`.

---

## Constraint

`onRemoveMention` applies only to user messages. Do not add it to assistant messages, tool rows, or plan step rows.
