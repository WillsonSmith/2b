# Plan 05 — Persist Tool Actions and Plan Steps in Chat History

## Context

Currently only `user` and `assistant` messages are saved to the SQLite database and reloaded on reconnect (`/api/chat-history`). Tool call/result rows and plan step indicators (added in Plan 01 and Plan 04) disappear on restart. This plan makes the sidecar a durable log.

Key files:
- `packages/app-episteme/src/db/workspaceDb.ts` — SQLite schema and queries
- `packages/app-episteme/src/server/index.ts` — HTTP routes including `/api/chat-history`
- `packages/app-episteme/src/App.tsx` — rehydrates messages on connect

## Goals

1. Extend the `chat_messages` DB table to store `tool` and `plan_step` entries.
2. Emit inserts from the server when tool calls/results and plan step events occur.
3. Update `/api/chat-history` to return the full set of message types.
4. Rehydrate all types in `App.tsx`.

---

## Step 1 — Read the existing schema

**File:** `packages/app-episteme/src/db/workspaceDb.ts`

Read this file fully before making changes. Understand:
- How `chat_messages` is currently defined (columns, types).
- How `insertMessage` and `getMessages` work.
- Whether migrations are handled manually or via a version table.

---

## Step 2 — Extend the schema

The simplest extensible approach: add a `meta` TEXT column (JSON blob) to `chat_messages` alongside the existing `role` and `text` columns. Tool and plan step entries use `meta` for their structured data; user/assistant entries leave it NULL.

If the table already exists in production, add a migration guard:

```ts
db.run(`ALTER TABLE chat_messages ADD COLUMN meta TEXT`);
// Wrap in try/catch — if column already exists, SQLite throws; ignore that error.
```

Or use a `PRAGMA user_version` migration system if one is already in place — follow the existing pattern.

---

## Step 3 — Add insert helpers

**File:** `packages/app-episteme/src/db/workspaceDb.ts`

Add or extend the insert function to accept the full `SidecarMessage` shape (minus the `notification` variant, which is ephemeral):

```ts
export function insertChatMessage(
  db: Database,
  workspacePath: string,
  msg:
    | { role: "user"; text: string }
    | { role: "assistant"; text: string }
    | { role: "tool"; name: string; status: "done" | "error"; error?: string }
    | { role: "plan_step"; planId: string; stepId: string; stepTitle: string; stepType: string; state: "complete" | "failed"; summary?: string; error?: string }
): number {
  const text = msg.role === "user" || msg.role === "assistant" ? msg.text : "";
  const meta = msg.role === "tool" || msg.role === "plan_step"
    ? JSON.stringify(msg)
    : null;
  const result = db.run(
    `INSERT INTO chat_messages (workspace, role, text, meta) VALUES (?, ?, ?, ?)`,
    [workspacePath, msg.role, text, meta],
  );
  return result.lastInsertRowid as number;
}
```

Add a `getMessages` helper that returns all stored messages for a workspace, deserializing `meta` where present.

---

## Step 4 — Persist tool events server-side

**File:** `packages/app-episteme/src/server/index.ts` (or wherever `tool_call` / `tool_result` are emitted)

Read the server to find where `{ type: "tool_call" }` and `{ type: "tool_result" }` messages are sent to the WebSocket. These are the points to insert DB writes.

For `tool_result` (only persist once resolved — not the "calling" state):

```ts
insertChatMessage(db, workspacePath, {
  role: "tool",
  name: msg.name,
  status: msg.error ? "error" : "done",
  error: msg.error,
});
```

Do not persist `tool_call` (the "calling" state) — it is always superseded by `tool_result` and adds noise without value.

---

## Step 5 — Persist plan step events server-side

**File:** `packages/app-episteme/src/server/handlers/plan.ts` or `packages/app-episteme/src/planning/PlanningController.ts`

Find where `plan_step_completed` and `plan_step_failed` are emitted. After emitting each, write to the DB:

```ts
// on plan_step_completed:
insertChatMessage(db, workspacePath, {
  role: "plan_step",
  planId, stepId, stepTitle,
  stepType: step.type,
  state: "complete",
  summary: msg.summary,
});

// on plan_step_failed:
insertChatMessage(db, workspacePath, {
  role: "plan_step",
  planId, stepId, stepTitle,
  stepType: step.type,
  state: "failed",
  error: msg.error,
});
```

You will need access to the step object (for `stepTitle` and `stepType`) at the point of emission. Read `PlanningController.ts` to understand what data is available there.

---

## Step 6 — Update /api/chat-history

**File:** `packages/app-episteme/src/server/index.ts`

The current `/api/chat-history` handler returns:

```ts
rows.map((r) => ({ id: r.id, role: r.role, text: r.text }))
```

Update it to:

```ts
rows.map((r) => {
  if (r.meta) {
    return { id: r.id, ...JSON.parse(r.meta) };
  }
  return { id: r.id, role: r.role, text: r.text };
})
```

---

## Step 7 — Rehydrate all message types in App.tsx

**File:** `packages/app-episteme/src/App.tsx`

The current rehydration (around line 210):

```ts
rows.map((r) => ({ role: r.role, text: r.text, id: r.id }))
```

Update to reconstruct the full `SidecarMessage` shape from each row:

```ts
rows.map((r): SidecarMessage => {
  if (r.role === "tool") {
    return { role: "tool", name: r.name, status: r.status, error: r.error };
  }
  if (r.role === "plan_step") {
    return {
      role: "plan_step",
      planId: r.planId, stepId: r.stepId,
      stepTitle: r.stepTitle, stepType: r.stepType,
      state: r.state, summary: r.summary, error: r.error,
    };
  }
  return { role: r.role as "user" | "assistant", text: r.text, id: r.id };
})
```

Import `SidecarMessage` type if not already imported in this scope.

---

## Note on ordering

Tool and plan step messages should be interleaved with user/assistant messages in the order they occurred. The `id` (auto-increment rowid) determines insertion order. The `ORDER BY id ASC` on the query (verify it exists, add if missing) is sufficient.

---

## Verification

- Send some chat messages and trigger several tool calls. Restart Episteme. Confirm the full history (including tool rows) reappears.
- Run a plan to completion. Restart. Confirm plan step rows appear in the sidecar.
- Confirm `notification` role messages do **not** persist (they are ephemeral and action-bearing).
- No TypeScript errors.
