# Episteme Cruft Inventory

Pre-existing dead code surfaced during the context/signals refactor (2026-05).
Re-run the verification command before deleting — if a new caller has appeared
since this audit, the verification will surface it.

---

## Dead client request handlers in `useEditorFeatures`

`hooks/useEditorFeatures.ts` exposes three request handlers that no UI ever
calls:

- `handleToneRequest(text, tone, from, to)` — sends WS `tone_transform`
- `handleSummarizeRequest(text, insertPos)` — sends WS `summarize_request`
- `handleTableRequest(text, insertPos)` — sends WS `table_request`

The server-side handlers exist (`server/handlers/editor.ts` cases
`tone_transform`, `summarize_request`, `table_request`), and the *result*
signals (`toneReplacement`, `summarizeResult`, `tableResult`) are wired
through `EditorContext` and consumed by `<Editor>`. The applied/clear path
works. But nothing on the client ever calls the three request handlers, so
the pipeline never starts — the result handlers are listeners for events
that never fire.

This is one of two states:

- **(a) Half-implemented feature.** Someone built end-to-end plumbing but
  never added the UI trigger (button, slash command, selection menu). To
  finish, wire the handlers into `<Editor>`'s selection menu or toolbar.
- **(b) Abandoned feature.** Delete the request handlers, the corresponding
  server cases, and the result-signal infrastructure.

**Verify state of the pipeline:**

```sh
grep -rn "handleToneRequest\|handleSummarizeRequest\|handleTableRequest" packages/app-episteme/src --include="*.tsx" --include="*.ts"
```

Expected output: only `useEditorFeatures.ts` (definitions + return). Any
external consumer means the pipeline got wired since this audit.

**Action — if abandoning (b):**

1. Remove from `useEditorFeatures.ts`:
   - `handleToneRequest`, `handleSummarizeRequest`, `handleTableRequest`
     (definitions + return).
   - State + WS subscriptions for the corresponding results
     (`toneReplacement`, `summarizeResult`, `tableResult`, plus their setters
     and the `tone_result` / `summarize_result` / `table_result` subscribers).
2. Remove from `state/EditorContext.tsx`:
   - `toneReplacement`, `summarizeResult`, `tableResult` signals.
   - `clearTone`, `clearSummarize`, `clearTable` methods.
3. Remove from `components/editor/Editor.tsx`:
   - Local mirrors for `toneReplacement` / `summarizeResult` / `tableResult`.
   - Any in-editor logic that consumes them (`onToneApplied`,
     `onSummarizeApplied`, `onTableApplied`).
4. Remove the server cases in `server/handlers/editor.ts` and the protocol
   types (`tone_transform`, `summarize_request`, `table_request`,
   `tone_result`, `summarize_result`, `table_result`) in `protocol.ts`.
5. Remove the dispatcher cases in `server/index.ts`.

---

## Out of scope (intentional, not cruft)

- The 4 remaining `useState` calls in `App.tsx` (`workspaceRoot`,
  `needsOnboarding`, `aiEnabled`, `theme`) are justified — `workspaceRoot` is
  lifted so AppShell's reconnect handler can set it; the other three are
  one-shot server-config flags that drive top-level conditional rendering.
- `themeReady: useRef(false)` guards the theme-load race and is also
  justified.
- The `useDebounce` hook is still used by `TocPanel` and stays.
