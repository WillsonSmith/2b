# Plan 01 — Tool Feedback Improvements

## Context

In `packages/app-episteme/src/components/AISidecar.tsx`, the sidecar renders tool call/result rows. When a tool completes — successfully or not — it always shows a green checkmark icon. The protocol message `tool_result` (in `protocol.ts`) carries only `{ type: "tool_result"; name: string }` with no success/failure signal. This plan fixes that and adds expandable detail rows.

## Goals

1. Add an optional `error` field to the `tool_result` protocol message.
2. Propagate that error from the server when a tool fails.
3. Update the `SidecarMessage` type and sidecar UI to show a red error icon on failure.
4. Make completed and failed tool rows expandable with a `<details>` element showing the response/error.

---

## Step 1 — Extend the protocol

**File:** `packages/app-episteme/src/protocol.ts`

Change the `tool_result` entry in `ServerMsg` from:

```ts
| { type: "tool_result"; name: string }
```

to:

```ts
| { type: "tool_result"; name: string; error?: string }
```

No other protocol changes needed.

---

## Step 2 — Find and update server-side tool_result emission

Read `packages/app-episteme/src/agent.ts` and `packages/app-episteme/src/server/index.ts` (and any file that calls `send({ type: "tool_result", ... })` or equivalent). Grep for `tool_result` across the package:

```
grep -r "tool_result" packages/app-episteme/src/
```

Wherever the server emits `tool_result`, check whether the tool execution produced an error or threw. If so, include `error: errorMessage` in the emitted message. If the tool succeeded, omit `error` (or pass `undefined`).

The exact mechanism depends on how the agent plugin system surfaces tool errors — read the relevant file before implementing. The key invariant: `error` should be a non-empty string on failure, absent on success.

---

## Step 3 — Update SidecarMessage type

**File:** `packages/app-episteme/src/components/AISidecar.tsx`

Change the `tool` variant of `SidecarMessage`:

```ts
// before
| { role: "tool"; name: string; status: "calling" | "done" }

// after
| { role: "tool"; name: string; status: "calling" | "done" | "error"; error?: string }
```

---

## Step 4 — Update App.tsx tool_result subscriber

**File:** `packages/app-episteme/src/App.tsx`

In the `unsubToolResult` subscriber (around line 413), when setting status to `"done"`, check `msg.error`:

```ts
const unsubToolResult = ws.subscribe("tool_result", (msg) =>
  setMessages((prev) => {
    for (let i = prev.length - 1; i >= 0; i--) {
      const m = prev[i];
      if (m && m.role === "tool" && m.name === msg.name && m.status === "calling") {
        const next = [...prev];
        next[i] = {
          role: "tool",
          name: msg.name,
          status: msg.error ? "error" : "done",
          error: msg.error,
        };
        return next;
      }
    }
    return prev;
  }),
);
```

---

## Step 5 — Update AISidecar tool row rendering

**File:** `packages/app-episteme/src/components/AISidecar.tsx`

In the `MessageList` component, in the `m.role === "tool"` branch:

1. Add `AlertCircle` to the lucide imports.
2. Show the appropriate icon:
   - `calling` → `<Loader2>` (existing)
   - `done` → `<Check>` (existing, green)
   - `error` → `<AlertCircle>` (new, red/destructive color)
3. Wrap the completed/error row in a `<details>` element so the user can expand it.

Example structure for the tool row after status resolves:

```tsx
if (m.status === "calling") {
  return (
    <div key={i} className="sidecar-tool-row calling">
      <span className="sidecar-tool-arrow"><CornerDownRight size={10} /></span>
      <span className="sidecar-tool-name">{toolDisplayName(m.name)}</span>
      <span className="sidecar-tool-status"><Loader2 size={11} className="icon-spin" /></span>
    </div>
  );
}

// done or error
return (
  <details key={i} className={`sidecar-tool-row ${m.status}`}>
    <summary className="sidecar-tool-summary">
      <span className="sidecar-tool-arrow"><CornerDownRight size={10} /></span>
      <span className="sidecar-tool-name">{toolDisplayName(m.name)}</span>
      <span className="sidecar-tool-status">
        {m.status === "error"
          ? <AlertCircle size={11} className="icon-error" />
          : <Check size={11} />}
      </span>
    </summary>
    <div className="sidecar-tool-detail">
      {m.error
        ? <span className="sidecar-tool-error-text">{m.error}</span>
        : <span className="sidecar-tool-ok-text">Completed successfully</span>}
    </div>
  </details>
);
```

---

## Step 6 — Add CSS

**File:** `packages/app-episteme/src/styles.css`

Add styles for the new elements. Search for `.sidecar-tool-row` to find the existing block and extend it:

- `.sidecar-tool-row.error .icon-error` — color: `var(--destructive)` or a red variable already in the palette.
- `.sidecar-tool-row details summary` — `list-style: none; cursor: pointer;`
- `.sidecar-tool-detail` — padding, muted text color, small font size.

Match the existing design language — check what color variables are defined at the top of `styles.css` before picking values.

---

## Verification

- Start Episteme (`bun run episteme`).
- Trigger an AI action that invokes a tool. Confirm the row shows a spinner while calling and a checkmark when done.
- Simulate or find a failing tool call. Confirm the row shows the error icon.
- Click a completed or failed row to expand the `<details>` and verify the detail text appears.
- No TypeScript errors (`bun run tsc --noEmit` or equivalent).
