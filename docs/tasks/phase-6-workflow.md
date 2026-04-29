# Phase 6 — Workflow, Ecosystem & Polish

## Status

- [ ] Implement alt-text generation for image paste/drop
- [ ] Implement "Explain This Code" hover action for fenced code blocks
- [ ] Implement `features/export.ts` — PDF export via Pandoc (shell), HTML export
- [ ] Build `ExportPanel.tsx` — export settings modal (format, theme, include/exclude frontmatter)
- [ ] Implement voice-to-Markdown — microphone button in toolbar → Whisper transcription
- [ ] (Stretch) Node compatibility layer — abstract `bun:sqlite`, `Bun.serve`, `Bun.file` behind adapters
- [ ] Final polish pass — fix any UI rough edges, keyboard shortcut conflicts, error messages
- [ ] Update `docs/tasks/phase-6-workflow.md` with results before ending session

## Current State

Phase 5 complete. Phase 6 not started.

## Last Known Good

[Update this when Phase 5 finishes]

## To Resume

1. Read `PROJECT_PLAN.md` for architecture overview
2. Read `docs/tasks/phase-5-research.md` to confirm Phase 5 (both sessions) is fully done
3. Read this file for Phase 6 task state
4. Run `bun --hot episteme.ts ~/your-test-workspace`
5. Verify Phase 5 research features still work
6. Continue with the first unchecked task above

## Implementation Notes

### Alt-Text Generation
- Listen for `paste` events on the editor; detect `image/png`, `image/jpeg` blobs in `event.clipboardData.files`
- Also handle drag-drop of image files onto the editor
- Upload image bytes to server: `{ type: "analyze_image", bytes: base64, filename }`
- Server uses `DynamicAgentPlugin`'s `image_vision` capability (already in the capability registry)
- Tool call: `analyze_image_file(path)` on `ImageVisionPlugin`
- Returns alt text; server responds with `{ type: "alt_text", text }`
- Client inserts `![{alt_text}](data:{mime};base64,{data})` at cursor
- **Requires**: `VISION_MODEL` env var set and a vision-capable model loaded in LMStudio/Ollama

### Code Documentation
- TipTap `NodeView` for `codeBlock` nodes: add a hover overlay with "Explain" button
- On click: send `{ type: "explain_code", code, language }` to server
- Server spawns `HeadlessAgent` with `bun_sandbox` capability
- Returns a plain-text explanation
- Insert as a comment above the code block (`<!-- Explanation: ... -->`) or as a callout blockquote

### Multi-Format Export (`features/export.ts`)
- **PDF via Pandoc**: `Bun.$\`pandoc ${inputFile} -o ${outputFile}.pdf\`` — requires `pandoc` in PATH
- **HTML**: `Bun.$\`pandoc ${inputFile} -o ${outputFile}.html --standalone --embed-resources\``
- If Pandoc not available, fall back to browser `window.print()` with CSS print styles
- `ExportPanel.tsx`: modal with format selector (PDF / HTML), theme picker (light/dark), frontmatter toggle
- Server: `POST /api/export { format, filePath, options }` → runs Pandoc, returns download link or bytes

### Voice-to-Markdown
- `kokoro-js` is in package.json — but it's a TTS library, not STT
- For STT: use Whisper via shell: `Bun.$\`whisper ${audioFile} --model base --output_format txt\``
- Requires `whisper` CLI in PATH (`pip install openai-whisper`)
- Flow: browser `MediaRecorder` captures audio → sends audio blob over WebSocket → server writes to temp file → whisper transcribes → sends transcript back
- Client inserts transcript at cursor

### Node Compatibility Layer (Stretch Goal)
This is a stretch goal — only implement if there's a specific deployment need.

- `src/adapters/sqlite.ts`:
  ```typescript
  // Bun path:
  export { Database } from "bun:sqlite";
  // Node path (if needed):
  // export { Database } from "better-sqlite3";
  ```
- `src/adapters/server.ts`: thin wrapper around `Bun.serve` / `fastify`
- `src/adapters/fs.ts`: `readFile`, `writeFile` wrapping `Bun.file` / `node:fs/promises`
- Create `episteme-node.ts` entry point that uses these adapters
- **Do not break the Bun path** — adapters must remain backward-compatible

### Polish Pass Checklist
- [ ] Error states: what happens when the LLM is offline? Show a clear "AI unavailable" message, not a spinner
- [ ] Empty state: when no files are in the workspace, show an "Open a folder" prompt
- [ ] Keyboard shortcuts: document all shortcuts in a `?` help panel
- [ ] Large files: if a document > 50k chars, warn before sending to autocomplete/lint (costs tokens)
- [ ] Memory on agent restart: workspace SQLite persists; verify that reopening the same workspace restores prior memory context correctly

## Open Questions

- **Audio format**: `MediaRecorder` default format varies by browser (webm/ogg/mp4). Whisper accepts mp3, mp4, wav. Transcode in browser via Web Audio API, or on server via ffmpeg (already a registered capability). Use ffmpeg approach — it's already available.
- **Pandoc availability**: Pandoc is not guaranteed to be installed. Add a check at server startup: `Bun.$\`which pandoc\`` — if missing, disable export routes and show a setup prompt in the UI.
- **Export download**: The exported file needs to be served to the browser for download. Option: write to a `/tmp/episteme-exports/` dir and serve as a static route `/api/exports/:filename`. Delete after 60 seconds.

## Files to Create/Modify This Phase

```
src/apps/episteme/features/export.ts          (new)
src/apps/episteme/components/ExportPanel.tsx   (new)
src/apps/episteme/components/Editor.tsx        (code block hover overlay, image drop handler, mic button)
src/apps/episteme/App.tsx                      (export panel toggle, voice recording state)
src/apps/episteme/server.ts                    (add analyze_image, explain_code, export, voice handlers)
src/adapters/sqlite.ts                         (new — stretch)
src/adapters/server.ts                         (new — stretch)
src/adapters/fs.ts                             (new — stretch)
episteme-node.ts                               (new — stretch)
```
