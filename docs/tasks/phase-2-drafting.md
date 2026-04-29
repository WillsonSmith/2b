# Phase 2 — Drafting & Ideation

## Status

- [x] Install pdfjs-dist (`bun add pdfjs-dist`) — installed 5.7.284
- [x] Implement `features/outline.ts` — prompt-to-outline via HeadlessAgent
- [x] Add "Generate Outline" command to `Editor.tsx` toolbar (toolbar button, disables while generating)
- [x] Implement `features/autocomplete.ts` — `AutocompleteRunner` class, context-aware suggestions
- [x] Add TipTap ghost-text extension to `Editor.tsx` (Tab to accept, Escape to dismiss)
- [x] Build `AISidecar.tsx` brainstorming mode (already built in Phase 1 — persists across file switches because messages live in App state, not Editor state)
- [x] Implement `ResearchPlugin.ts` — `ingest_url(url)` using `@mozilla/readability` + JSDOM
- [x] Implement `ResearchPlugin.ts` — `ingest_pdf(path)` using pdfjs-dist
- [x] Add drag-drop URL/PDF handler to `App.tsx` (drag-over overlay + drop handler)
- [x] Register `ResearchPlugin` in `agent.ts`
- [x] Update `docs/tasks/phase-2-drafting.md` with results

## Current State

Phase 2 complete. All tasks implemented and type-checked (no new errors).

## Last Known Good

Phase 2 implementation (not yet browser-tested):
- `bun episteme.ts /tmp/episteme-test` → server at :4000
- All WebSocket messages wired in server.ts: `autocomplete_request`, `outline_request`, `ingest_url`, `ingest_pdf`, `insert_text`, `autocomplete_suggestion`, `ingest_result`
- Pre-existing tsc errors from Phase 1 remain (storage.markdown types, unused EditorContextPlugin var); no new errors introduced

## Files Created/Modified This Phase

```
src/apps/episteme/features/outline.ts         (new) — generateOutline() via HeadlessAgent
src/apps/episteme/features/autocomplete.ts    (new) — AutocompleteRunner class
src/apps/episteme/plugins/ResearchPlugin.ts   (new) — ingest_url + ingest_pdf tools
src/apps/episteme/components/Editor.tsx       (modified) — ghost-text extension, outline button, autocomplete hooks
src/apps/episteme/App.tsx                     (modified) — ghost state, drag-drop, autocomplete/outline/ingest WS handling
src/apps/episteme/server.ts                   (modified) — new WS message handlers + AutocompleteRunner
src/apps/episteme/agent.ts                    (modified) — ResearchPlugin registered, MemoryPlugin(llm) fix
src/apps/episteme/styles.css                  (modified) — .ghost-text rule
package.json / bun.lockb                      (modified) — pdfjs-dist 5.7.284 added
```

## Implementation Notes

### Outline flow
- Client sends `{ type: "outline_request", topic }` (topic derived from filename)
- Server calls `generateOutline(topic, config)` → HeadlessAgent one-shot
- Server broadcasts `{ type: "insert_text", text }` → client appends to editor content

### Autocomplete flow
- Editor fires `onAutocompleteRequest(context)` after 800ms idle (debounced in Editor.tsx)
- App sends `{ type: "autocomplete_request", context }` to server
- Server calls `autocomplete.suggest(context)` (fire-and-forget, result sent only to requesting WS)
- Client receives `{ type: "autocomplete_suggestion", text }` → sets `ghostText` state
- Ghost text rendered via ProseMirror decoration; Tab accepts (inserts + clears), Escape dismisses

### Research flow
- **URL**: drag-drop or agent tool → `ingest_url` WS → `agent.addDirect("ingest_url …")` → ResearchPlugin.executeTool → fetch + Readability + HeadlessAgent summary → writes to `research/<slug>.md` + CortexMemory
- **PDF**: drag-drop sends `ingest_pdf` with filename → `agent.addDirect("ingest_pdf …")` → pdfjs-dist extracts text → HeadlessAgent summary → writes to `research/<stem>.md` + CortexMemory
- PDF drag-drop limitation (documented in Open Questions): File object from browser gives only filename; only PDFs already in workspace root by that name can be found

### AISidecar persistence
- Messages array lives in `App` state, not inside `AISidecar` — switching files does not clear the chat history

## Open Questions (Carried Forward)

- **Tab key conflict**: Tab in ghost-text extension intercepts before TipTap's list indentation. Only fires if `ghostRef.current` is non-empty, so list indentation still works when no ghost is active. ✅ resolved by design
- **PDF path limitation**: drag-drop only works for PDFs already in workspace root. For arbitrary drops, upload-over-WebSocket would be needed (Phase 5/6 scope).
- **Outline topic**: currently uses the active filename. Could allow user to type a custom topic via a dialog. Future improvement.

## To Resume (Phase 3)

1. Read `PROJECT_PLAN.md` for architecture overview
2. Read `docs/tasks/phase-3-editing.md` for task state
3. Run `bun --hot episteme.ts ~/your-test-workspace`
4. Open `http://localhost:4000` — verify Phase 2 UI: ghost-text suggestions, Outline button, drag-drop overlay
5. Continue with the first unchecked task in `phase-3-editing.md`
