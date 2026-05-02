# Task: Refactor App.tsx into custom hooks

## Context

`src/apps/episteme/App.tsx` is the root React component for the Episteme editor app. It is
~1200 lines with 40+ `useState`/`useRef`/`useCallback`/`useEffect` declarations all crammed
into a single `App()` function. The goal of this task is to extract that logic into focused
custom hooks so `App()` becomes a thin coordinator (~150 lines) that wires hooks together and
renders JSX.

**Constraints:**
- No behaviour changes. Every callback, state transition, and side-effect must work identically
  after the refactor.
- The rendered JSX tree in `App()` stays the same — do not restructure the markup.
- Do not add features, error handling, or abstractions beyond what the task requires.
- Default to writing no comments. Only add one when the WHY is non-obvious.
- Use Bun (`bun:*`, `Bun.*`). Do not introduce new npm packages.
- All new hook files live in `src/apps/episteme/hooks/`.

Read `src/apps/episteme/App.tsx` in full before making any changes.

---

## WebSocket message types

The WS protocol types (`ServerMsg`, `ClientMsg`) are defined inline in `App.tsx`. The
`ServerMsg` union is used inside the `onmessage` handler. Keep that type in `App.tsx` or
move it to a shared file — whichever keeps imports clean. Do not duplicate it.

---

## Hooks to extract

### 1. `useWebSocket` → `src/apps/episteme/hooks/useWebSocket.ts`

**Owns:**
- `agentState` state (`"idle" | "thinking" | "disconnected"`)
- `wsRef` (`useRef<WebSocket | null>`)
- The `useEffect` that calls `connect()` / reconnects on close (the big block starting with
  `function connect()`)
- All `agent.on(...)` style WS event wiring — i.e. mapping incoming `ServerMsg` to setter
  calls. Pass setters in via a callbacks parameter (see signature below).
- `sendToAgent(text)` — sends `{ type: "send", text }` and appends the user message
- `interrupt()` — sends `{ type: "interrupt" }`

**Signature:**
```ts
export function useWebSocket(callbacks: {
  onSpeak: (text: string) => void;
  onStateChange: (state: "idle" | "thinking") => void;
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  onToolResult: (name: string) => void;
  onFileContent: (path: string, content: string) => void;
  onWorkspaceFiles: (files: string[]) => void;
  onFileSaved: () => void;
  onFileCreated: (path: string) => void;
  onFileRenamed: (oldPath: string, newPath: string) => void;
  onAutocompleteSuggestion: (text: string) => void;
  onInsertText: (text: string) => void;
  onIngestResult: (success: boolean, message: string) => void;
  onLintResult: (issues: LintIssue[]) => void;
  onToneResult: (text: string, from: number, to: number) => void;
  onSummarizeResult: (text: string, insertPos: number) => void;
  onMetadataResult: (yaml: string) => void;
  onTocResult: (entries: TocEntry[]) => void;
  onAutolinkResult: (suggestions: WikilinkSuggestion[]) => void;
  onDiagramResult: (code: string, from: number, to: number) => void;
  onTableResult: (text: string, insertPos: number) => void;
  onSearchResult: (results: UnifiedSearchResponse) => void;
  onDetectGapsResult: (markdown: string) => void;
  onContradictionsData: (contradictions: ContradictionRecord[]) => void;
  onGraphData: (data: GraphData) => void;
  onCheckCitationsResult: (result: { valid: string[]; broken: string[] }) => void;
  onFormatCitationResult: (bibtex: string) => void;
  onAltText: (text: string, mimeType: string, base64: string) => void;
  onExplainCodeResult: (explanation: string) => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}): {
  wsRef: React.MutableRefObject<WebSocket | null>;
  agentState: "idle" | "thinking" | "disconnected";
  sendToAgent: (text: string) => void;
  interrupt: () => void;
}
```

`App()` will construct the `callbacks` object inline using stable `useCallback` refs or
direct state setters, then pass it to `useWebSocket`.

---

### 2. `useFileManager` → `src/apps/episteme/hooks/useFileManager.ts`

**Owns:**
- `activeFile`, `editorContent`, `savedContent`, `isDirty` state
- `debouncedContent` (the existing `useDebounce` call — keep `useDebounce` defined in
  `App.tsx` or move it to a shared utils file, whichever is cleaner)
- `workspaceFiles`, `workspaceName`, `needsWorkspace`, `isPickingWorkspace` state
- `autosaveEnabled` state
- The dirty-tracking effect (`editorContent !== savedContent`)
- The autosave effect
- The `⌘S` / `Ctrl+S` keyboard shortcut listener
- The editor content ref (`editorContentRef`) and active file ref (`activeFileRef`)
- `openFile`, `saveFile`, `createFile`, `renameFile`, `refreshFiles`, `handleOpenWorkspace`
  callbacks

**Receives via params:** `wsRef`, `agentState`

**Returns:** all of the above state values and callbacks, plus setters that the WS hook needs
(`setActiveFile`, `setEditorContent`, `setSavedContent`, `setIsDirty`, `setWorkspaceFiles`,
`setWorkspaceName`, `setNeedsWorkspace`, `setAutosaveEnabled`,
`editorContentRef`, `activeFileRef`).

---

### 3. `useEditorFeatures` → `src/apps/episteme/hooks/useEditorFeatures.ts`

**Owns the inline AI features that flow into `<Editor>`:**
- `ghostText`, `autocompleteEnabled` state and `handleAutocompleteRequest`,
  `handleGhostAccept`, `handleGhostDismiss`
- `toneReplacement` and `handleToneRequest`
- `summarizeResult` and `handleSummarizeRequest`
- `isGeneratingMetadata`, `metadataResult` and `handleMetadataRequest`
- `isTocGenerating`, `tocEntries` and `handleGenerateToc`, `handleHeadingClick`
- `autolinkSuggestions` and `handleAutolinkAccept`, `handleAutolinkDismiss`,
  `handleAutolinkDismissAll`
- `diagramResult` and `handleDiagramRequest`
- `tableResult` and `handleTableRequest`
- `lintIssues`
- `isGeneratingOutline` and `handleGenerateOutline`

**Receives via params:** `wsRef`, `agentState`, `activeFile`

**Returns:** all state values, result values, and callbacks above, plus any setters the WS
callbacks need (`setGhostText`, `setLintIssues`, `setToneReplacement`, `setSummarizeResult`,
`setMetadataResult`, `setIsGeneratingMetadata`, `setTocEntries`, `setIsTocGenerating`,
`setAutolinkSuggestions`, `setDiagramResult`, `setTableResult`, `setIsGeneratingOutline`,
`setAutocompleteEnabled`).

---

### 4. `useResearch` → `src/apps/episteme/hooks/useResearch.ts`

**Owns:**
- `showResearch`, `searchResults`, `gapReport`, `isSearching`, `isDetectingGaps` state
- `handleSearch`, `handleDetectGaps`, `handleIngestFromSearch`, `handleReindex` callbacks

**Receives via params:** `wsRef`, `agentState`

**Returns:** all state values, callbacks, plus `setShowResearch`, `setSearchResults`,
`setGapReport`, `setIsSearching`, `setIsDetectingGaps` (for WS result handlers).

---

### 5. `useConflictsAndGraph` → `src/apps/episteme/hooks/useConflictsAndGraph.ts`

**Owns:**
- `showConflicts`, `contradictions`, `isScanning` state
- `showGraph`, `graphData`, `isLoadingGraph` state
- `handleOpenConflicts`, `handleContradictionScan`
- `handleOpenGraph`, `handleRefreshGraph`, `handleGraphNodeClick`

**Receives via params:** `wsRef`, `agentState`, `openFile` (for `handleGraphNodeClick`)

**Returns:** all state values and callbacks, plus `setContradictions`, `setIsScanning`,
`setGraphData`, `setIsLoadingGraph`, `setShowConflicts`, `setShowGraph` (for WS result
handlers).

---

### 6. `useVoiceAndMedia` → `src/apps/episteme/hooks/useVoiceAndMedia.ts`

**Owns:**
- `isRecording`, `mediaRecorderRef`, `audioChunksRef` state/refs
- `altTextInsert` state and the `useEffect` that inserts it into editor content
- `handleToggleRecording`, `handleImagePaste` callbacks

**Receives via params:** `wsRef`, `agentState`, `setEditorContent`
  (needed for the transcript insert and the altTextInsert effect)

**Returns:** `isRecording`, `handleToggleRecording`, `handleImagePaste`, plus
`setAltTextInsert` (for the WS `alt_text` handler).

---

## What stays in `App.tsx`

After extraction, `App()` contains:
1. Calls to all six hooks, threading setters between them where the WS hook needs to call
   back into file/feature state.
2. The remaining local state: `messages`, `sidecarCollapsed`, `showSettings`, `showExport`,
   `isExporting`, `pandocAvailable`, `showHelp`, `dismissedLargeFile`, `isDragOver`,
   `showResearch`, `showGraph`, `showConflicts` (if not moved to hooks above).
3. The `sendToAgent` / `interrupt` wrappers and the sidecar message callbacks
   (`handleAskAboutSelection`, `handleExplainCode`).
4. Drag-and-drop handlers (`handleDragOver`, `handleDragLeave`, `handleDrop`).
5. The export handler (`handleExport`).
6. The Electron detection effect.
7. The initial `/api/config` fetch effect.
8. The workspace picker.
9. The full JSX render tree — unchanged.
10. The `useDebounce` helper (or import it from a hooks util if extracted).
11. `AutolinkBanner`, `HelpPanel`, `LargeFileBanner` sub-components — leave in `App.tsx`.

---

## Implementation order

1. Read `src/apps/episteme/App.tsx` in full.
2. Create `src/apps/episteme/hooks/` directory.
3. Extract hooks in this order to minimise cascading type errors:
   `useFileManager` → `useEditorFeatures` → `useResearch` → `useConflictsAndGraph` →
   `useVoiceAndMedia` → `useWebSocket`.
4. Update `App.tsx` last — replace extracted state/effects/callbacks with hook calls.
5. Verify no TypeScript errors by running `bun run tsc --noEmit` (or equivalent) if a
   typecheck script exists, otherwise do a careful manual pass.

---

## Done criteria

- `App()` is ≤ 200 lines (excluding imports and sub-components).
- Each hook file is self-contained: imports its own types, exports one function.
- No state, effect, or callback is duplicated between `App.tsx` and a hook.
- The rendered JSX in `App.tsx` is byte-for-byte identical to before (modulo whitespace from
  variable renames).
- `bun run tsc --noEmit` passes (or there were no pre-existing type errors and none are
  introduced).
