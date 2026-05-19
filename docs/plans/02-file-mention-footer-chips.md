# Plan 02 — Footer Chip Rendering for File Mentions

## Instructions for Claude

Before writing any code, evaluate every proposed change against the existing codebase patterns. Check that the implementation matches the style, error handling, and conventions already present in the files being modified. The visual design of new components must be consistent with existing patterns in the same file. Only proceed once you are confident the changes are high quality and consistent with the surrounding code.

---

## Goal

Render `@filename.md` tokens found in user messages as collapsible chips in a footer area below the message text. Chip content is fetched on-demand from `/api/file-content` when the user expands a chip. This plan depends on Plan 01 being implemented first — after Plan 01, `chat_messages` stores the original `@mention` form, making on-demand fetching the correct approach.

---

## Background

User messages are currently rendered as raw text at `AISidecar.tsx:294`. The footer approach adds collapsible chips below the message body without modifying the inline text — the text still contains `@filename.md` as plain text, and the footer is purely additive. File content is not stored in the message — it is fetched from the server at expand time so it always reflects the current file state.

The existing `<details>`/`<summary>` pattern used for tool call rows (lines 200–216) is the correct visual precedent for the chip expand/collapse mechanic.

---

## Files to Modify

- `packages/app-episteme/src/components/AISidecar.tsx`
- `packages/app-episteme/src/styles.css`

---

## Relevant Existing Code

Current user message render block in `MessageList` (lines 278–297):

```tsx
return (
  <div key={i} className="sidecar-msg user">
    <div className="sidecar-msg-header">
      <span className="sidecar-msg-role">You</span>
      {onDeleteMessage && (
        <div className="sidecar-msg-header-actions">
          <button
            className="sidecar-delete-btn"
            onClick={() => onDeleteMessage(i)}
            title="Delete message"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
    <div className="sidecar-msg-user-text">{m.text}</div>
  </div>
);
```

Tool call `<details>` pattern as visual reference (lines 200–216):

```tsx
<details key={i} className={`sidecar-tool-row ${m.status}`}>
  <summary className="sidecar-tool-summary">
    <span className="sidecar-tool-arrow"><CornerDownRight size={10} /></span>
    <span className="sidecar-tool-name">{toolDisplayName(m.name)}</span>
    <span className="sidecar-tool-status"><Check size={11} /></span>
  </summary>
  <div className="sidecar-tool-detail">…</div>
</details>
```

File content endpoint for on-demand fetching: `GET /api/file-content?path=<relpath>` returns `{ content: string }` on success or `{ error: string }` on failure.

---

## Implementation Steps

### 1. Add `extractMentions` helper

Add this function near the existing mention helpers (`getMentionQuery`, `insertMention`) around line 307:

```typescript
function extractMentions(text: string): string[] {
  return [...text.matchAll(/@([\w\-./ ]+\.md)/g)].map((m) => m[1]!.trim());
}
```

### 2. Add `FileMentionChip` component

Add this component in the component section of the file, before `MessageList`:

```tsx
interface FileMentionChipProps {
  path: string;
}

function FileMentionChip({ path }: FileMentionChipProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const short = path.split("/").at(-1) ?? path;

  function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || content !== null || loading) return;
    setLoading(true);
    fetch(`/api/file-content?path=${encodeURIComponent(path)}`)
      .then((r) => r.json() as Promise<{ content?: string }>)
      .then((d) => {
        if (d.content != null) setContent(d.content);
        else setError(true);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  return (
    <details className="sidecar-mention-chip" onToggle={handleToggle}>
      <summary className="sidecar-mention-chip-summary">
        <span className="sidecar-mention-chip-name">@{short}</span>
      </summary>
      <div className="sidecar-mention-chip-content">
        {loading && <span className="sidecar-mention-chip-loading">Loading…</span>}
        {error && <span className="sidecar-mention-chip-error">Could not load file.</span>}
        {content !== null && <pre className="sidecar-mention-chip-pre">{content}</pre>}
      </div>
    </details>
  );
}
```

### 3. Update the user message render block

Replace the user message render block in `MessageList` (lines 278–297) with:

```tsx
const mentions = extractMentions(m.text);
return (
  <div key={i} className="sidecar-msg user">
    <div className="sidecar-msg-header">
      <span className="sidecar-msg-role">You</span>
      {onDeleteMessage && (
        <div className="sidecar-msg-header-actions">
          <button
            className="sidecar-delete-btn"
            onClick={() => onDeleteMessage(i)}
            title="Delete message"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
    </div>
    <div className="sidecar-msg-user-text">{m.text}</div>
    {mentions.length > 0 && (
      <div className="sidecar-mention-footer">
        {mentions.map((p) => (
          <FileMentionChip key={p} path={p} />
        ))}
      </div>
    )}
  </div>
);
```

### 4. Add CSS

Add styles for the new classes to `styles.css`. Match the visual density and color variables of the existing `.sidecar-tool-row`, `.sidecar-tool-summary`, and `.sidecar-tool-detail` rules — use those as the direct reference for spacing, font size, and color tokens. New classes to define:

- `.sidecar-mention-footer` — container below the message text; small top margin, no extra padding
- `.sidecar-mention-chip` — the `<details>` element; styled close to `.sidecar-tool-row`
- `.sidecar-mention-chip-summary` — the `<summary>` element; inline flex, cursor pointer
- `.sidecar-mention-chip-name` — the `@filename` label; muted color, small font
- `.sidecar-mention-chip-content` — the expanded content area
- `.sidecar-mention-chip-pre` — file content display; monospace, small font, scrollable, max-height capped
- `.sidecar-mention-chip-loading` — muted loading text
- `.sidecar-mention-chip-error` — error text in error color

---

## Constraint

Do not replace `@filename.md` in the message text body. The text renders verbatim — the footer is additive only.
