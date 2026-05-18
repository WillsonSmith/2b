# Plan 07 — Message Actions (Remove Execute/Continue, Add Dropdown)

## Context

Every assistant message in the sidecar currently has two action buttons: **Execute** and **Continue**. These are low-signal actions that add clutter. This plan removes them and replaces the action area with a compact dropdown menu containing three focused actions: **Regenerate**, **Copy**, and **Send to Plan**.

Key file:
- `packages/app-episteme/src/components/AISidecar.tsx`
- `packages/app-episteme/src/components/PlanPanel.tsx` — reference for PlanRequestForm seeding
- `packages/app-episteme/src/App.tsx` — wires `onSendToPlan` to plan panel

## Goals

1. Remove the `EXECUTE_PROMPT` constant and the Execute + Continue buttons from assistant messages.
2. Add a dropdown button (⋯) on each assistant message with: Regenerate, Copy, Send to Plan.
3. **Regenerate** — removes this assistant message (and any messages after it that are assistant/tool/plan_step), then re-sends the preceding user message.
4. **Copy** — copies the message text to clipboard (consolidate with the existing `CopyButton`).
5. **Send to Plan** — opens the Plan panel with the message text pre-filled as the goal.

---

## Step 1 — Remove Execute/Continue

**File:** `packages/app-episteme/src/components/AISidecar.tsx`

Delete:
- The `EXECUTE_PROMPT` constant (line ~29).
- The entire `.sidecar-msg-actions` div inside the `assistant` message render branch (the div containing Execute and Continue buttons).
- The `onContinueFrom` prop from `MessageListProps`, `AISidecarProps`, and `ChatModalProps` — if it is no longer used anywhere after this change. Verify before deleting.

---

## Step 2 — Add dropdown state to the assistant message render

**File:** `packages/app-episteme/src/components/AISidecar.tsx`

The `MessageList` function currently renders assistant messages inline. To add dropdown state per-message without converting `MessageList` to a class or adding a global map, extract the assistant message row into a small inner component `AssistantMessage`:

```tsx
interface AssistantMessageProps {
  message: Extract<SidecarMessage, { role: "assistant" }>;
  index: number;
  onRegenerate: () => void;
  onSendToPlan: (text: string) => void;
  onNavigate?: (path: string) => void;
  onDeleteMessage?: (index: number) => void;
}

function AssistantMessage({ message, index, onRegenerate, onSendToPlan, onNavigate, onDeleteMessage }: AssistantMessageProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  return (
    <div className="sidecar-msg assistant">
      <div className="sidecar-msg-header">
        <span className="sidecar-msg-role">Episteme</span>
        <div className="sidecar-msg-header-actions">
          <div className="sidecar-msg-menu" ref={menuRef}>
            <button
              className="sidecar-menu-trigger"
              onClick={() => setMenuOpen(v => !v)}
              title="Actions"
            >
              <MoreHorizontal size={12} />
            </button>
            {menuOpen && (
              <div className="sidecar-msg-dropdown">
                <button className="sidecar-dropdown-item" onClick={() => { setMenuOpen(false); onRegenerate(); }}>
                  Regenerate
                </button>
                <button className="sidecar-dropdown-item" onClick={() => { setMenuOpen(false); navigator.clipboard.writeText(message.text).catch(() => {}); }}>
                  Copy
                </button>
                <button className="sidecar-dropdown-item" onClick={() => { setMenuOpen(false); onSendToPlan(message.text); }}>
                  Send to Plan
                </button>
              </div>
            )}
          </div>
          {onDeleteMessage && (
            <button className="sidecar-delete-btn" onClick={() => onDeleteMessage(index)} title="Delete message">
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>
      <MarkdownView content={message.text} className="sidecar-msg-markdown" onNavigate={onNavigate} />
    </div>
  );
}
```

Add `MoreHorizontal` to the lucide imports.

Replace the existing assistant branch in `MessageList` with:

```tsx
if (m.role === "assistant") {
  return (
    <AssistantMessage
      key={i}
      message={m}
      index={i}
      onRegenerate={() => {
        // Find the preceding user message and re-send it.
        // Remove this message and everything after it, then re-send.
        // This is handled via a new prop passed down.
        onRegenerate?.(i);
      }}
      onSendToPlan={onSendToPlan ?? (() => {})}
      onNavigate={onNavigate}
      onDeleteMessage={onDeleteMessage}
    />
  );
}
```

Add `onRegenerate?: (assistantIndex: number) => void` and `onSendToPlan?: (text: string) => void` to `MessageListProps`.

---

## Step 3 — Implement Regenerate in App.tsx

**File:** `packages/app-episteme/src/App.tsx`

Add a `handleRegenerate` callback:

```ts
const handleRegenerate = useCallback((assistantIndex: number) => {
  // Find the user message that immediately precedes this assistant message.
  const prev = messages.slice(0, assistantIndex);
  const lastUserIndex = [...prev].reverse().findIndex(m => m.role === "user");
  if (lastUserIndex === -1) return;
  const userMsg = prev[prev.length - 1 - lastUserIndex];
  if (!userMsg || userMsg.role !== "user") return;

  // Trim messages to just before the user message and re-send.
  const truncated = prev.slice(0, prev.length - 1 - lastUserIndex);
  setMessages(truncated);
  sendToAgent(userMsg.text);
}, [messages, sendToAgent]);
```

Pass it to `AISidecar` as `onRegenerate={handleRegenerate}` and thread it to `MessageList`.

---

## Step 4 — Implement Send to Plan

**Option A — Open Plan panel with pre-filled goal:**

Add a `seedGoal` prop to `PlanPanel` and `PlanRequestForm`. When `seedGoal` is set and no plan is active, the `PlanRequestForm` textarea initialises with that value.

In `PlanRequestForm`:

```ts
interface PlanRequestFormProps {
  ...
  seedGoal?: string;
}

function PlanRequestForm({ ..., seedGoal }: PlanRequestFormProps) {
  const [goal, setGoal] = useState(seedGoal ?? "");
  // When seedGoal changes from outside, sync it:
  useEffect(() => { if (seedGoal) setGoal(seedGoal); }, [seedGoal]);
  ...
}
```

Pass `seedGoal` down: `PlanPanel` → `PlanRequestForm`.

In `App.tsx`:

```ts
const [planSeedGoal, setPlanSeedGoal] = useState("");

const handleSendToPlan = useCallback((text: string) => {
  setPlanSeedGoal(text);
  setShowPlan(true);
}, []);
```

Pass `planSeedGoal` to `PlanPanel`:
```tsx
<PlanPanel
  ...
  seedGoal={planSeedGoal}
  onSeedConsumed={() => setPlanSeedGoal("")}
/>
```

In `PlanRequestForm`, after the form submits, call `onSeedConsumed?.()` to clear the seed. Add `onSeedConsumed?: () => void` to `PlanPanelProps` and thread it down.

Wire `handleSendToPlan` to `AISidecar` as `onSendToPlan={handleSendToPlan}`.

---

## Step 5 — CSS

**File:** `packages/app-episteme/src/styles.css`

Add styles for the dropdown near the `.sidecar-msg-actions` block (which will now be removed — search and delete the old block):

```css
.sidecar-msg-menu {
  position: relative;
}

.sidecar-menu-trigger {
  /* match .sidecar-copy-btn style */
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-dim);
  padding: 2px;
  border-radius: 3px;
  display: flex;
  align-items: center;
}
.sidecar-menu-trigger:hover {
  color: var(--text-main);
  background: var(--bg-hover);
}

.sidecar-msg-dropdown {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 50;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  min-width: 130px;
  overflow: hidden;
}

.sidecar-dropdown-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  padding: 7px 12px;
  font-size: 12px;
  color: var(--text-main);
  cursor: pointer;
}
.sidecar-dropdown-item:hover {
  background: var(--bg-hover);
}
```

Use existing variables — verify against `styles.css`.

---

## Step 6 — Clean up ChatModal

**File:** `packages/app-episteme/src/components/AISidecar.tsx`

`ChatModal` renders a `MessageList` — pass the new `onRegenerate` and `onSendToPlan` props through to it. Also remove `onContinueFrom` from `ChatModal` if that prop is being removed.

---

## Verification

- Open the sidecar, send a message, receive an assistant reply. Confirm Execute and Continue are gone.
- Click the ⋯ menu on an assistant message. Confirm three items appear: Regenerate, Copy, Send to Plan.
- **Regenerate:** confirm the assistant message is removed, the user message that preceded it is re-sent, and a new response arrives.
- **Copy:** confirm the text is in the clipboard.
- **Send to Plan:** confirm the Plan panel opens with the message text pre-filled in the goal textarea.
- No TypeScript errors.
