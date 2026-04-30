# Phase 6 — Workflow, Ecosystem & Polish

## Status

- [x] Implement alt-text generation for image paste/drop
- [x] Implement "Explain This Code" hover action for fenced code blocks
- [x] Implement `features/export.ts` — PDF export via Pandoc (shell), HTML export
- [x] Build `ExportPanel.tsx` — export settings modal (format, include/exclude frontmatter)
- [x] Implement voice-to-Markdown — microphone button in toolbar → Whisper transcription
- [ ] (Stretch) Node compatibility layer — abstract `bun:sqlite`, `Bun.serve`, `Bun.file` behind adapters
- [x] Final polish pass — fix any UI rough edges, keyboard shortcut conflicts, error messages
- [x] Update `docs/tasks/phase-6-workflow.md` with results before ending session

## Current State

Phase 6 complete. All non-stretch tasks implemented. App builds clean (1916 modules, no errors).

## Last Known Good

Phase 6 session — all features implemented and verified via `bun build`.

## Implemented Features

### Alt-Text Generation (image paste/drop)
- `Editor.tsx`: paste event listener on TipTap DOM detects image files, reads as base64, calls `onImagePaste`
- `App.tsx` drop handler also handles `image/*` files in addition to PDFs and URLs
- `server.ts` `analyze_image` handler: writes to temp, calls LLM with filename hint to generate alt text
- Client inserts `![alt text](data:mime;base64,...)` at end of document
- Graceful fallback to filename-based alt text if LLM unavailable

### Explain This Code
- `Editor.tsx`: `mouseover`/`mouseout` events on the editor DOM detect `<pre>` hover
- Shows a fixed-position "Explain" button overlay (`code-explain-overlay`)
- On click: sends `{ type: "explain_code", code, language }` to server
- `features/explain.ts`: HeadlessAgent with a concise prose-explanation prompt
- Result appears in AI Sidecar; sidecar auto-expands if collapsed

### Multi-Format Export
- `features/export.ts`: `checkPandoc()` runs at server startup, sets `pandocAvailable`; `exportDocument()` runs Pandoc for PDF/HTML, writes to `/tmp/episteme-exports/`, deletes temp input
- `components/ExportPanel.tsx`: modal with HTML/PDF format selector and frontmatter toggle
- `server.ts` `POST /api/export`: reads workspace file, calls `exportDocument`, schedules 60s cleanup, returns download URL
- `server.ts` `GET /api/exports/:filename`: serves exported file for download
- `/api/health` now includes `pandocAvailable: boolean` so the client knows at startup
- `App.tsx`: export panel toggled by ↓ button in header; `handleExport()` POSTs to `/api/export` and triggers browser download

### Voice-to-Markdown
- `Editor.tsx`: mic toolbar button (⏺ Voice / ⏹ Stop) shown when `onToggleRecording` prop provided
- `App.tsx` `handleToggleRecording()`: uses `MediaRecorder`, collects audio chunks, on stop converts to base64 and sends `{ type: "voice_data", audioBase64, mimeType }`
- `server.ts` `voice_data` handler: checks for `whisper` CLI, writes audio to temp, converts via `ffmpeg` if available, runs `whisper --model base`, sends `transcript` message back
- Client appends transcript to editor content at cursor
- Graceful error if whisper or ffmpeg not installed

### Polish Pass
- **Offline state**: red "AI unavailable — reconnecting…" banner when disconnected; status indicator turns red
- **Large file warning**: banner shown when document exceeds 50k chars, skips autocomplete for large files
- **Empty workspace**: sidebar replaced with an "open a folder" prompt when no `.md` files exist
- **Keyboard shortcuts help**: `?` key or `?` button in header opens `HelpPanel` modal listing all shortcuts
- **Drop overlay**: updated text to include "image" alongside URL and PDF

## Files Created/Modified

```
src/apps/episteme/features/export.ts          (new)
src/apps/episteme/features/explain.ts         (new)
src/apps/episteme/components/ExportPanel.tsx   (new)
src/apps/episteme/components/Editor.tsx        (image paste, code hover, mic button)
src/apps/episteme/App.tsx                      (all new handlers, export, voice, polish)
src/apps/episteme/server.ts                    (analyze_image, explain_code, voice_data, export routes)
src/apps/episteme/styles.css                   (Phase 6 styles)
```

## To Resume (if continuing)

1. Read `PROJECT_PLAN.md` for architecture overview
2. Read this file for Phase 6 state
3. Run `bun --hot episteme.ts ~/your-test-workspace`
4. Voice requires `pip install openai-whisper` and optionally `brew install ffmpeg`
5. Export requires `brew install pandoc`
6. The stretch goal (Node compatibility layer) is the only remaining unimplemented item

## Open Questions (resolved)

- **Audio format**: handled — ffmpeg converts webm/ogg/mp4 to mp3 before whisper
- **Pandoc availability**: handled — checked at startup, UI reflects availability, clear install prompt
- **Export download**: handled — temp files served at `/api/exports/:filename`, deleted after 60s
