# Plan 04 — Plan Step Indicators in the Sidecar

## Context

When a plan runs, all visual feedback lives exclusively in the Plan panel (`PlanPanel.tsx`). The AI sidecar only shows the agent's text responses after each step. This plan injects live plan step indicators into the sidecar's message list so it becomes a unified log of all activity — tool calls, plan steps, and AI messages together.

Key files:
- `packages/app-episteme/src/components/AISidecar.tsx` — message types and rendering
- `packages/app-episteme/src/App.tsx` — subscribes to WebSocket events and populates `messages`
- `packages/app-episteme/src/hooks/usePlanning.ts` — plan state
- `packages/app-episteme/src/components/PlanPanel.tsx` — existing step UI to reference

## Goals

1. Add a `plan_step` variant to `SidecarMessage`.
2. In `App.tsx`, subscribe to `plan_step_started`, `plan_step_completed`, and `plan_step_failed` events and push/update plan step entries in `messages`.
3. Render plan step rows in the sidecar that visually mirror the `StepRow` component from `PlanPanel.tsx` (compact form, not the full editable version).

---

## Step 1 — Extend SidecarMessage

**File:** `packages/app-episteme/src/components/AISidecar.tsx`

Import the plan step type:

```ts
import type { EpistemePlanStepType } from "../planning/types.ts";
```

Add to the `SidecarMessage` union:

```ts
| {
    role: "plan_step";
    planId: string;
    stepId: string;
    stepTitle: string;
    stepType: EpistemePlanStepType;
    state: "running" | "complete" | "failed";
    summary?: string;
    error?: string;
  }
```

---

## Step 2 — Subscribe and update messages in App.tsx

**File:** `packages/app-episteme/src/App.tsx`

The plan subscriptions for step events currently live in `usePlanning.ts`. `App.tsx` needs its own subscriptions for the sidecar, while `usePlanning` keeps its subscriptions for plan state — both can subscribe to the same events independently.

Add a ref to hold the latest plan so step titles can be looked up:

```ts
const planRef = useRef(planning.plan);
useEffect(() => { planRef.current = planning.plan; }, [planning.plan]);
```

Inside the existing large `useEffect` that subscribes to WebSocket messages (around line 402), add three more subscriptions:

```ts
const unsubStepStarted = ws.subscribe("plan_step_started", (msg) => {
  const plan = planRef.current;
  const step = plan?.steps.find(s => s.id === msg.stepId);
  if (!step) return;
  setMessages(prev => [
    ...prev,
    {
      role: "plan_step",
      planId: msg.planId,
      stepId: msg.stepId,
      stepTitle: step.title,
      stepType: step.type,
      state: "running",
    },
  ]);
});

const unsubStepCompleted = ws.subscribe("plan_step_completed", (msg) => {
  setMessages(prev =>
    prev.map(m =>
      m.role === "plan_step" && m.stepId === msg.stepId
        ? { ...m, state: "complete", summary: msg.summary }
        : m,
    ),
  );
});

const unsubStepFailed = ws.subscribe("plan_step_failed", (msg) => {
  setMessages(prev =>
    prev.map(m =>
      m.role === "plan_step" && m.stepId === msg.stepId
        ? { ...m, state: "failed", error: msg.error }
        : m,
    ),
  );
});
```

Add the three new unsubs to the cleanup `return` at the bottom of the `useEffect`.

Also add them to the dependency array if `ws.subscribe` is listed there (it is stable via `useCallback`, so this should not cause extra re-subscriptions).

---

## Step 3 — Render plan step rows in MessageList

**File:** `packages/app-episteme/src/components/AISidecar.tsx`

Study the icon map and state icons from `PlanPanel.tsx` (`STEP_TYPE_ICONS`, `STEP_TYPE_LABELS`, and the `stateIcon()` function inside `StepRow`). Re-declare compact versions locally in `AISidecar.tsx` (do not import from `PlanPanel.tsx` to avoid coupling).

In `MessageList`, in the `messages.map` block, add a branch before the `assistant` check:

```tsx
if (m.role === "plan_step") {
  const stateIcon = () => {
    switch (m.state) {
      case "running":  return <Loader2 size={11} className="icon-spin" />;
      case "complete": return <CheckCircle2 size={11} className="sidecar-plan-step-done" />;
      case "failed":   return <AlertCircle size={11} className="sidecar-plan-step-fail" />;
    }
  };

  const isExpandable = !!(m.summary || m.error);

  return isExpandable ? (
    <details key={i} className={`sidecar-plan-step sidecar-plan-step--${m.state}`}>
      <summary className="sidecar-plan-step-summary">
        <span className="sidecar-plan-step-state">{stateIcon()}</span>
        <span className="sidecar-plan-step-title">{m.stepTitle}</span>
        <span className="sidecar-plan-step-type">{m.stepType}</span>
      </summary>
      <div className="sidecar-plan-step-detail">
        {m.error
          ? <span className="sidecar-plan-step-error">{m.error}</span>
          : <span className="sidecar-plan-step-result">{m.summary}</span>}
      </div>
    </details>
  ) : (
    <div key={i} className={`sidecar-plan-step sidecar-plan-step--${m.state}`}>
      <span className="sidecar-plan-step-state">{stateIcon()}</span>
      <span className="sidecar-plan-step-title">{m.stepTitle}</span>
      <span className="sidecar-plan-step-type">{m.stepType}</span>
    </div>
  );
}
```

Add `CheckCircle2`, `AlertCircle` to the lucide imports if not already imported.

---

## Step 4 — CSS

**File:** `packages/app-episteme/src/styles.css`

Add styles near the `.sidecar-tool-row` block to maintain visual consistency:

```css
.sidecar-plan-step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 4px 12px;
  color: var(--text-muted);
}

.sidecar-plan-step summary {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  list-style: none;
}

.sidecar-plan-step-type {
  margin-left: auto;
  font-size: 10px;
  opacity: 0.6;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.sidecar-plan-step-done { color: var(--accent); }  /* match existing success color */
.sidecar-plan-step-fail { color: var(--destructive); }

.sidecar-plan-step-detail {
  padding: 4px 0 4px 17px;
  font-size: 11px;
  color: var(--text-dim);
}
```

Check what color variables exist in `styles.css` before writing values.

---

## Verification

- Start Episteme, open a plan, and begin execution.
- Confirm that as each step starts, a "running" row appears in the sidecar.
- Confirm that when the step completes, the row updates to "complete" with the summary visible on expand.
- Confirm that after the AI response comes in, it appears below the step row in the correct order.
- Test a failing step: confirm the row shows the error icon and error text on expand.
- No TypeScript errors.
