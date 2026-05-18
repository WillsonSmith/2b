# Plan 06 — Planning Mode in the Sidecar

## Context

The only way to create a plan currently is via the Plan panel's `PlanRequestForm` textarea (`PlanPanel.tsx`). This feels disconnected from the AI chat flow. This plan adds a "planning mode" toggle to the sidecar's `ChatInput` that surfaces the approval mode options and "plan from document" checkbox above the textarea, then on submit sends a `plan_request` (or `plan_from_document`) and auto-opens the Plan panel.

As a bonus, this enables `@filename.md` mentions in the plan goal — something the current plan form does not support.

Key files:
- `packages/app-episteme/src/components/AISidecar.tsx` — `ChatInput` component
- `packages/app-episteme/src/App.tsx` — wires sidecar to planning hooks and plan panel state
- `packages/app-episteme/src/hooks/usePlanning.ts` — `requestPlan`, `requestPlanFromDocument`

## Goals

1. Add a planning mode toggle to `ChatInput`.
2. When active, show "Approve all at once" / "Approve step-by-step" radio buttons + "Plan from current document" checkbox above the textarea.
3. On submit in planning mode, call `onPlanRequest` / `onPlanRequestFromDocument` (new props) instead of `onSend`.
4. `@filename.md` mentions in the goal text are resolved and included in the request (same mechanism as the existing chat mention resolution in `App.tsx`).
5. Submitting auto-opens the Plan panel and opens the sidecar.

---

## Step 1 — New props on AISidecar and ChatInput

**File:** `packages/app-episteme/src/components/AISidecar.tsx`

Add to `AISidecarProps`:

```ts
activeFile?: string | null;
onPlanRequest?: (goal: string, approvalMode: "all" | "per_step") => void;
onPlanRequestFromDocument?: (path: string, goal: string, approvalMode: "all" | "per_step") => void;
```

Pass them through to `ChatInput`.

Add to `ChatInputProps`:

```ts
activeFile?: string | null;
onPlanRequest?: (goal: string, approvalMode: "all" | "per_step") => void;
onPlanRequestFromDocument?: (path: string, goal: string, approvalMode: "all" | "per_step") => void;
```

---

## Step 2 — Planning mode state in ChatInput

**File:** `packages/app-episteme/src/components/AISidecar.tsx`, inside `ChatInput`

Add local state:

```ts
const [planMode, setPlanMode] = useState(false);
const [approvalMode, setApprovalMode] = useState<"all" | "per_step">("all");
const [useDocument, setUseDocument] = useState(false);
```

---

## Step 3 — Planning mode toggle button

Add a plan mode toggle button to `.sidecar-input-toolbar`, next to the existing Zap button. Use the `ClipboardList` icon from lucide (already imported in `PlanPanel.tsx`; add to `AISidecar.tsx`'s imports).

```tsx
<button
  className={`sidecar-quick-toggle${planMode ? " active" : ""}`}
  onClick={() => setPlanMode(v => !v)}
  title={planMode ? "Exit planning mode" : "Create a plan"}
  disabled={isThinking}
>
  <ClipboardList size={14} />
</button>
```

When `planMode` is true, also update the textarea placeholder to `"Describe what you want to accomplish… (@ to reference files)"`.

---

## Step 4 — Planning mode UI above the textarea

When `planMode` is true, render a small options bar above the `.sidecar-input-box`:

```tsx
{planMode && (
  <div className="sidecar-plan-mode-options">
    <label className="sidecar-plan-mode-label">
      <input
        type="radio"
        name="sidecar-approval"
        checked={approvalMode === "all"}
        onChange={() => setApprovalMode("all")}
      />
      Approve all at once
    </label>
    <label className="sidecar-plan-mode-label">
      <input
        type="radio"
        name="sidecar-approval"
        checked={approvalMode === "per_step"}
        onChange={() => setApprovalMode("per_step")}
      />
      Approve step-by-step
    </label>
    {activeFile && (
      <label className="sidecar-plan-mode-label">
        <input
          type="checkbox"
          checked={useDocument}
          onChange={e => setUseDocument(e.target.checked)}
        />
        Plan from current document
      </label>
    )}
  </div>
)}
```

---

## Step 5 — Override submit behavior in planning mode

In the `submit()` function of `ChatInput`:

```ts
function submit() {
  const text = input.trim();
  if (!text || isThinking) return;

  if (planMode) {
    if (useDocument && activeFile && onPlanRequestFromDocument) {
      onPlanRequestFromDocument(activeFile, text, approvalMode);
    } else if (onPlanRequest) {
      onPlanRequest(text, approvalMode);
    }
    setInput("");
    setPlanMode(false);
    setUseDocument(false);
    closeMention();
    return;
  }

  onSend(text);
  setInput("");
  closeMention();
}
```

---

## Step 6 — @mention resolution for plan goals

**File:** `packages/app-episteme/src/App.tsx`

The existing `sendToAgent` already resolves `@filename.md` mentions and prepends file content to the message. Apply the same logic to the plan goal before sending.

Add a helper (or reuse/extract the existing one):

```ts
async function resolveGoalMentions(goal: string): Promise<string> {
  const mentionPattern = /@([\w\-./ ]+\.md)/g;
  const mentions = [...goal.matchAll(mentionPattern)].map(m => m[1].trim());
  if (mentions.length === 0) return goal;

  const fetched = await Promise.all(
    mentions.map(path =>
      fetch(`/api/file-content?path=${encodeURIComponent(path)}`)
        .then(r => r.json() as Promise<{ content?: string }>)
        .then(d => d.content != null ? { path, content: d.content } : null)
        .catch(() => null),
    ),
  );
  const blocks = fetched
    .filter((f): f is { path: string; content: string } => f !== null)
    .map(f => `[File: ${f.path}]\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");
  return blocks ? `${blocks}\n\n---\n${goal}` : goal;
}
```

Wire `onPlanRequest` in `App.tsx`:

```ts
const handleSidecarPlanRequest = useCallback(async (goal: string, approvalMode: "all" | "per_step") => {
  const resolvedGoal = await resolveGoalMentions(goal);
  planning.requestPlan(resolvedGoal, approvalMode);
  setShowPlan(true);
  setSidecarCollapsed(false);
}, [planning]);

const handleSidecarPlanRequestFromDocument = useCallback(async (path: string, goal: string, approvalMode: "all" | "per_step") => {
  const resolvedGoal = await resolveGoalMentions(goal);
  planning.requestPlanFromDocument(path, resolvedGoal, approvalMode);
  setShowPlan(true);
  setSidecarCollapsed(false);
}, [planning]);
```

Pass these to `AISidecar`:

```tsx
<AISidecar
  ...
  activeFile={fileManager.activeFile}
  onPlanRequest={handleSidecarPlanRequest}
  onPlanRequestFromDocument={handleSidecarPlanRequestFromDocument}
/>
```

---

## Step 7 — CSS

**File:** `packages/app-episteme/src/styles.css`

Add styles near the `.sidecar-quick-actions` block:

```css
.sidecar-plan-mode-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--surface-subtle, var(--bg-panel));
}

.sidecar-plan-mode-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
}
```

Use existing CSS variables — check `styles.css` for the right variable names.

---

## Verification

- Click the planning mode toggle (clipboard icon) in the sidecar input toolbar. Confirm the approval mode options appear.
- Type a goal, select "Approve step-by-step", and submit. Confirm the plan panel opens, `plan_request` is sent with the correct approval mode.
- Type a goal with `@somefile.md`, submit. Confirm the file content is included in the goal sent to the server.
- Enable "Plan from current document" with a file open. Confirm `plan_from_document` is sent with the correct path.
- After submitting, confirm planning mode is reset to off.
- No TypeScript errors.
