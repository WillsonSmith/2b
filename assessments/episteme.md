# Assessment: episteme
**File:** src/apps/episteme/
**Reviewed:** 2026-05-01
**Risk level:** High

## Bug Fixes

- [ ] **`App.tsx:731-735` — `handleOpenGraph` sets `isLoadingGraph=true` before connection guard**: If the agent is disconnected, `isLoadingGraph` is set to true but no `graph_data` response ever arrives. The `error` handler resets it, but `graph_request` is never sent, so no error fires either — the spinner hangs forever. Same pattern in `handleContradictionScan` (line 723) and `handleSearch` (line 693). Fix: move `setIsLoadingGraph(true)` / `setIsScanning(true)` / `setIsSearching(true)` to after the connection guard, or ensure a timeout resets loading state.

- [ ] **`contradiction.ts:53` — Windowed scanning only compares memories within each 15-item slice**: `runContradictionScan` iterates with `i += WINDOW` (WINDOW=15), comparing only memories within each batch. Contradictions between memory[0] and memory[16] are never detected. Fix: use a sliding window or compare all pairs up to a budget limit.

- [ ] **`App.tsx:486-496` — `agentState` used in effect body but absent from dependency array**: The `editor_context` sync effect checks `agentState === "disconnected"` but `agentState` is not in `[debouncedContent, activeFile]`. The check works in practice because `wsRef.current` becomes null on disconnect, but the missing dep silently hides the intent and will cause lint warnings. Fix: add `agentState` to the dep array or remove the redundant check.

- [ ] **`agent.ts:84` — `addDirect("Call the index_workspace tool now…")` is fragile natural language**: Startup indexing relies on the LLM parsing a prose instruction to call a specific tool. If the agent is busy, ignores it, or re-phrases it, the workspace won't be indexed at startup. Fix: prefer a direct `agent.executeTool("index_workspace", {})` call or equivalent framework method after `agent.start()`.

## Security

- [ ] **`server.ts` (lines 370, 389, 418, 442, 292) + `WorkspacePlugin.ts:200` + `ResearchPlugin.ts:189` — Path traversal via non-anchored `startsWith` check**: All path boundary checks use `absolute.startsWith(absRoot)`. If `absRoot` is `/workspace`, a path resolving to `/workspace-evil/secret.md` passes the check. Fix everywhere: `absolute.startsWith(absRoot + "/") || absolute === absRoot`.

- [ ] **`server.ts:637-642` — User-supplied `mimeType` used unsanitized to construct a temp file extension**: In the `analyze_image` handler, `ext` is derived from `mimeType.split("/")[1]`. If a WS client sends `mimeType: "image/../../../../etc/passwd"`, `ext` would contain path traversal components. `join(tmpdir(), \`episteme-img-${Date.now()}.${ext}\`)` is then normalized by `path.join`, which resolves `..` segments — resulting in a write outside `tmpdir`. Fix: sanitize ext to alphanumeric only: `const ext = (mimeType.split("/")[1] ?? "png").replace(/[^a-z0-9]/g, "").slice(0, 10) || "png"`.

- [ ] **`server.ts:482-494` — User-supplied URLs and PDF paths injected into agent context via `addDirect`**: `agent.addDirect(\`ingest_url ${url}\`)` embeds the raw user-provided URL as a natural-language agent message. A crafted URL string (e.g. containing `\nIgnore previous instructions`) can inject arbitrary text into the agent's turn. Fix: sanitize the URL before embedding, or route through a structured method that bypasses the LLM message queue.

- [ ] **`server.ts:309` — Filename in `Content-Disposition` response header not escaped**: `/api/exports/:filename` sets `Content-Disposition: attachment; filename="${filename}"`. Although filenames are generated server-side, the original baseName ultimately derives from a client-supplied `filePath`. A quote character in a filename would produce a malformed header. Fix: RFC 5987-encode the filename or replace `"` in the output filename.

## Refactoring / Code Quality

- [ ] **`App.tsx` — 1 200-line God component with 40+ state variables**: All editor state, file state, WS state, and feature flags live in one `App()` function. This makes the component hard to navigate and test. Consider extracting `useWebSocket`, `useFileManager`, `useEditorFeatures`, and `useResearch` custom hooks to isolate concerns without changing the rendered tree.

- [ ] **`server.ts:369-460` — Repeated path-resolution + boundary-check boilerplate (4×)**: The pattern `const absolute = msg.path.startsWith("/") ? msg.path : resolve(join(absRoot, msg.path)); if (!absolute.startsWith(absRoot)) { send error }` is copy-pasted for `file_open`, `file_save`, `file_create`, and `file_rename`. Extract a `resolveWorkspacePath(absRoot, relativePath): string | null` helper.

- [ ] **`agent.ts:33` — Typo in exported type name `EpistemAgentBundle`**: Should be `EpistemeAgentBundle` to match the rest of the codebase naming. The typo is currently propagated to `server.ts:76`.

- [ ] **`WorkspacePlugin.ts:82` — `fact_check` tool description references Phase 5 as future work**: The description says "Full contradiction detection is available in Phase 5." — this text is in the LLM-visible tool description and is now stale/misleading since contradiction scanning ships on this branch. Update the description to reflect current capability.

- [ ] **`EditorContextPlugin.ts:23` — `clearEditorState()` is public but never called**: Dead public API. Either call it when a workspace is closed, or remove it.

- [ ] **`App.tsx` lines 218, 222, 225, 232 — "Phase 6" development comments left in shipped code**: Feature flags and WIP comments referencing phases should be cleaned up now that features are shipped. They add noise without value.

## Performance

- [ ] **`WorkspacePlugin.ts:119-128` — `indexWorkspace` appends duplicate memory entries on every call**: Each call to `index_workspace` writes a new memory record per file without checking whether the content has changed. Memory entries accumulate unboundedly across re-indexes (startup + user-triggered). Consider using an upsert keyed on `relativePath`, or deleting stale workspace-file memories before re-indexing.

- [ ] **`server.ts:219-223` — `collectMarkdownFiles` (full directory scan) runs after every file-mutating tool result**: The `agent.on("tool_result", ...)` callback fires after every `write_file`, `append_file`, etc., and immediately runs a new glob scan to push updated `workspace_files` to all clients. For workspaces with thousands of files, this could be expensive. Consider debouncing this broadcast with a short delay (~200ms).

- [ ] **`contradiction.ts:38` — All 100 factual memories loaded into RAM on every 30-minute background scan**: The scan fetches `limit: 100` memories unconditionally and creates a new `HeadlessAgent` per 15-item batch. Each batch makes a full LLM round-trip. For a large workspace this could be slow; consider tracking a `lastScanTimestamp` and only scanning memories added since the last scan.

## Consistency / Style Alignment

- [ ] **`features/outline.ts:14` — Outline generation uses the `autocomplete` model**: `generateOutline` calls `featureModel(config, "autocomplete")`, which selects the fast/cheap inline-completion model. Outline generation is a higher-complexity structured task more appropriate for the `default` model. Compare with `toc.ts` and `metadata.ts` which both use `default`.

- [ ] **`server.ts:199-200` — Second `DiagramPlugin` instance created alongside the one registered on the agent**: `agent.ts` registers a `DiagramPlugin` on the agent (for LLM-driven diagram generation), and `server.ts` creates a separate `DiagramPlugin` instance for direct `diagram_request` WebSocket handling. Two separate plugin instances = two separate LLM provider connections. Reuse the one from the bundle or document the intentional dual-path design.

- [ ] **`server.ts:248-256` — `/api/models` hardcodes the Ollama endpoint `127.0.0.1:11434`**: The Ollama URL should come from config or the provider layer rather than being hardcoded in the server route. Breaks for non-default Ollama installs.

## Notes

**Cross-module concern — `ContradictionRecord`/`GraphData` types defined in `contradiction.ts`**: `buildKnowledgeGraph` and its `GraphData`/`GraphNode`/`GraphLink` types live in `contradiction.ts`. The graph builder is not conceptually part of contradiction scanning; as the graph grows to include non-contradiction edges, this colocation will feel increasingly wrong. A future `knowledge-graph.ts` module would be a natural split.

**`AutoApprovePermissionManager` on the main agent**: `agent.ts:49` installs `AutoApprovePermissionManager`, meaning every tool call — including `write_file`, `delete_file`, and `move_file` — is auto-approved without user confirmation. This is intentional for a fast UX, but reviewers of `FileSystemPlugin` should know this means the LLM can freely modify the workspace without prompting.
