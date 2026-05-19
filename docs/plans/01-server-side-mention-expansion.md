# Plan 01 — Move Mention Expansion Server-Side

## Instructions for Claude

Before writing any code, evaluate every proposed change against the existing codebase patterns. Check that the implementation matches the style, error handling, and conventions already present in the files being modified. Only proceed once you are confident the changes are high quality and consistent with the surrounding code.

---

## Goal

Stop storing expanded file content in `chat_messages`. Store the original `@mention` form instead, and expand file content on the server before feeding to the agent. This fixes the relaunch clutter bug where full file contents appear in the chat history UI.

---

## Background

`resolveMentions` in `App.tsx` fetches file content client-side and builds a `fullText` string with injected code blocks. `sendToAgent` sends `fullText` over the WebSocket but keeps the original `text` in React state. The server stores whatever it receives — `fullText` — so `chat_messages` ends up with full file content. On relaunch, that expanded text is loaded from the DB and rendered verbatim.

The plan path (`handleSidecarPlanRequest`, `handleSidecarPlanRequestFromDocument`) also calls `resolveMentions`, but plan goals are stored in `ep_plans.goal`, not `chat_messages`, and are not displayed as user message chips. **Leave the plan path unchanged.**

---

## Files to Modify

- `packages/app-episteme/src/App.tsx`
- `packages/app-episteme/src/server/index.ts`

---

## Existing Code to Remove — `App.tsx`

Delete `resolveMentions` entirely (lines 299–317):

```typescript
const resolveMentions = useCallback(async (text: string): Promise<string> => {
  const mentionPattern = /@([\w\-./ ]+\.md)/g;
  const mentions = [...text.matchAll(mentionPattern)].map((m) => m[1].trim());
  if (mentions.length === 0) return text;
  const fetched = await Promise.all(
    mentions.map((path) =>
      fetch(`/api/file-content?path=${encodeURIComponent(path)}`)
        .then((r) => r.json() as Promise<{ content?: string }>)
        .then((d) => (d.content != null ? { path, content: d.content } : null))
        .catch(() => null),
    ),
  );
  const blocks = fetched
    .filter((f): f is { path: string; content: string } => f !== null)
    .map((f) => `[File: ${f.path}]\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");
  return blocks ? `${blocks}\n\n---\n${text}` : text;
}, []);
```

---

## Existing Code to Replace — `App.tsx`

`sendToAgent` currently (lines 319–327):

```typescript
const sendToAgent = useCallback(
  async (text: string) => {
    if (ws.agentState === "disconnected") return;
    const fullText = await resolveMentions(text);
    ws.sendToAgent(fullText);
    setMessages((prev) => [...prev, { role: "user", text }]);
  },
  [ws, resolveMentions],
);
```

Replace with:

```typescript
const sendToAgent = useCallback(
  (text: string) => {
    if (ws.agentState === "disconnected") return;
    ws.sendToAgent(text);
    setMessages((prev) => [...prev, { role: "user", text }]);
  },
  [ws],
);
```

---

## Existing Code to Replace — `server/index.ts`

The `resolveWorkspacePath` helper already exists at lines 216–219 and must be used for path safety:

```typescript
function resolveWorkspacePath(inputPath: string): string | null {
  const absolute = inputPath.startsWith("/") ? inputPath : resolve(join(absRoot, inputPath));
  return isWithinWorkspace(absolute, absRoot) ? absolute : null;
}
```

The `"send"` dispatch case currently (lines 75–83):

```typescript
case "send":
  if (msg.text.trim()) {
    if (ctx.planning.isLocked) return;
    ctx.workspaceDb.appendChatMessage("user", msg.text.trim());
    ctx.agent.addDirect(msg.text.trim());
  }
  return;
```

Replace with:

```typescript
case "send": {
  const original = msg.text.trim();
  if (!original) return;
  if (ctx.planning.isLocked) return;
  ctx.workspaceDb.appendChatMessage("user", original);
  const mentionPattern = /@([\w\-./ ]+\.md)/g;
  const mentions = [...original.matchAll(mentionPattern)].map((m) => m[1]!.trim());
  let fullText = original;
  if (mentions.length > 0) {
    const blocks = (
      await Promise.all(
        mentions.map(async (rel) => {
          const abs = resolveWorkspacePath(rel);
          if (!abs) return null;
          try {
            const content = await Bun.file(abs).text();
            return `[File: ${rel}]\n\`\`\`\n${content}\n\`\`\``;
          } catch {
            return null;
          }
        }),
      )
    )
      .filter((b): b is string => b !== null)
      .join("\n\n");
    if (blocks) fullText = `${blocks}\n\n---\n${original}`;
  }
  ctx.agent.addDirect(fullText);
  return;
}
```

---

## Known Tradeoff

`shortTermMemory.seed()` in `server/index.ts` (lines 168–176) seeds the agent with recent chat history on startup. After this change it will seed with compact `@mention` text rather than expanded file content. This is acceptable — the agent has `FileSystemPlugin` registered and can read files directly if it needs their content.
