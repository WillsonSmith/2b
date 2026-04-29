# Phase 5 — Research Workstation (The Epistemic Layer)

This phase is split into two sessions. Complete Session 5a fully before starting 5b.

---

## Session 5a — Search & Ingestion

### Status

- [ ] Add `search_arxiv(query)` tool to `ResearchPlugin.ts` — arXiv API (no key required: `export.arxiv.org/api/query`)
- [ ] Add `search_wikipedia(query)` tool to `ResearchPlugin.ts` — Wikipedia API (already have WikipediaPlugin as capability, reuse)
- [ ] Add `unified_search(query)` tool — merges arXiv + Wikipedia + `search_workspace`, deduplicates, ranks by relevance
- [ ] Build `ResearchPanel.tsx` — tabbed results panel (All | arXiv | Wikipedia | Workspace)
- [ ] Add "Ingest" button per search result → calls `ingest_url` on the result URL
- [ ] Implement `features/research.ts` — deep PDF ingestion (PDF → structured MD template)
- [ ] Structured MD template sections: Abstract, Methodology, Findings, Limitations, Citation
- [ ] Save ingested templates to `.episteme/ingested/` directory
- [ ] Implement `detect_gaps(topic)` tool — HeadlessAgent analyzes workspace memory for underrepresented perspectives
- [ ] Update `docs/tasks/phase-5-research.md` (Session 5a section) before ending session

### Session 5a — Current State

Phase 4 complete. Phase 5 not started.

### Session 5a — Last Known Good

[Update this when Phase 4 finishes]

### Session 5a — To Resume

1. Read `PROJECT_PLAN.md` for architecture overview
2. Read `docs/tasks/phase-4-structural.md` to confirm Phase 4 is fully done
3. Read this file — work only on Session 5a tasks above
4. Run `bun --hot episteme.ts ~/your-research-workspace`
5. Verify Phase 4 features still work
6. Continue with the first unchecked 5a task

### Session 5a — Implementation Notes

#### arXiv Search
- API endpoint: `https://export.arxiv.org/api/query?search_query={query}&max_results=10`
- Returns Atom XML — parse with `DOMParser` or a regex-based parser
- Fields needed: `title`, `summary`, `author`, `published`, `link` (abs URL)
- Rate limit: 3 requests/second max — add a small delay between calls

#### Wikipedia Search
- `WikipediaPlugin` is already registered as a capability in `DynamicAgentPlugin`
- Expose it directly in `ResearchPlugin` rather than spawning a sub-agent, for lower latency
- Endpoint: `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={query}&format=json`

#### Unified Search
- Run arXiv, Wikipedia, and `search_workspace` in parallel (`Promise.all`)
- Merge results; rank by: workspace results first (most relevant to user's existing notes), then by keyword overlap with query
- Deduplicate by URL/title similarity

#### Deep PDF Ingestion (`features/research.ts`)
- Phase 2 added basic PDF ingestion; Phase 5 upgrades it to structured extraction
- Prompt HeadlessAgent with `research` model to identify sections and extract them
- Template output format:
  ```markdown
  ---
  title: "..."
  authors: [...]
  year: YYYY
  source: "path/or/url"
  tags: [research, ingested]
  ---
  ## Abstract
  ## Methodology
  ## Key Findings
  ## Limitations
  ## Citation
  ```

#### Literature Gap Detection
- `detect_gaps(topic)` calls HeadlessAgent with all workspace memories tagged `["workspace-file"]`
- Prompt: "Given these notes on {topic}, identify perspectives, counterarguments, or sub-topics that are missing or underrepresented."
- Returns a gap report as insertable Markdown

---

## Session 5b — Intelligence & Visualization

### Status

- [ ] Implement `features/contradiction.ts` — cross-library conflict detection
- [ ] Schedule contradiction scan as a background task (runs every 30 minutes while workspace is open)
- [ ] Store contradictions in workspace memory with type `"contradiction"` and linked memory IDs
- [ ] Build `ConflictsPanel.tsx` — shows contradictions with source context (reuse pattern from `src/ui/web/components/ConflictsPanel.tsx`)
- [ ] Install `react-force-graph` (`bun add react-force-graph`)
- [ ] Build `KnowledgeGraph.tsx` — force-directed graph of memory nodes and links
- [ ] Wire graph: nodes from `queryMemoriesRaw({ types: ["factual"] })`, edges from `get_linked_memories`
- [ ] Clicking a node scrolls to or opens the related file
- [ ] Implement `CitationPlugin.ts` — `check_citations()` and `format_citation(url)`
- [ ] `check_citations()` scans frontmatter `bibliography` field; validates URLs with HEAD requests
- [ ] `format_citation(url)` generates a BibTeX entry using HeadlessAgent
- [ ] Export: writes/updates `references.bib` in workspace root
- [ ] Update `docs/tasks/phase-5-research.md` (Session 5b section) before ending session

### Session 5b — Current State

Session 5a complete. Session 5b not started.

### Session 5b — Last Known Good

[Update this when Session 5a finishes]

### Session 5b — To Resume

1. Read `PROJECT_PLAN.md` for architecture overview
2. Read this file — confirm Session 5a tasks are checked off
3. Run `bun --hot episteme.ts ~/your-research-workspace`
4. Verify unified_search and deep ingestion from 5a still work
5. Continue with the first unchecked 5b task

### Session 5b — Implementation Notes

#### Contradiction Detection (`features/contradiction.ts`)
- Use the existing `behavior:conflict_detected` pattern from `BehaviorPlugin` as a reference
- Query all factual memories: `memoryPlugin.queryMemoriesRaw({ types: ["factual"], limit: 200 })`
- Chunk into pairs of semantically similar memories (use `hybridSearch` per memory to find near-neighbors)
- HeadlessAgent with `research` model evaluates each pair: "Do these two statements contradict each other?"
- If yes: `memoryPlugin.writeMemory(contradictionSummary, "factual", ["contradiction"], "episteme")`
- Then link the two conflicting memories: `memoryPlugin.linkMemories(idA, idB, "contradicts")`
- Background task: `agent.scheduleProactiveTick(30 * 60 * 1000, () => { ... })`

#### Knowledge Graph (`KnowledgeGraph.tsx`)
- `react-force-graph` renders a `<ForceGraph2D>` with `{ nodes, links }` data
- Nodes: `{ id, label, type, file }` — one per memory or per workspace file
- Links: from `get_linked_memories` calls; also "contradiction" links in red
- Color nodes by type: factual (blue), thought (gray), contradiction (red)
- Clicking a node: if it has a file tag, call `file_open` on that path
- Performance: limit to top 200 nodes by recency; add a "Load more" control

#### Citation Plugin (`plugins/CitationPlugin.ts`)
- `check_citations()` tool:
  1. Get active file content from `EditorContextPlugin`
  2. Parse YAML frontmatter for a `bibliography: [url1, url2]` list
  3. For each URL, send `HEAD` request (with timeout 5s); flag 4xx/5xx as broken
  4. Return `{ valid: string[], broken: string[] }`
- `format_citation(url)` tool:
  1. Fetch page with `@mozilla/readability` to get title, author, date
  2. HeadlessAgent formats as BibTeX: `@misc{key, title={...}, author={...}, year={...}, url={...}}`
- `export_citations()` tool: appends all citations to `references.bib` in workspace root

## Open Questions

- **Graph performance**: `react-force-graph` with 200+ nodes can be slow. Cap at 150 nodes initially; add virtualization if needed.
- **Contradiction false positives**: LLM contradiction detection on short memory snippets has high false-positive rate. Add a confidence score threshold (only flag if model says "definite contradiction") and let users dismiss from ConflictsPanel.
- **Citation BibTeX keys**: Generate keys as `author:year:firstword` (e.g., `smith:2023:attention`). Collision handling: append `a`, `b`, `c` suffix.

## Files to Create/Modify This Phase

```
src/apps/episteme/features/research.ts        (updated — deep ingestion)
src/apps/episteme/features/contradiction.ts   (new)
src/apps/episteme/plugins/ResearchPlugin.ts   (updated — arxiv, unified_search, detect_gaps)
src/apps/episteme/plugins/CitationPlugin.ts   (new)
src/apps/episteme/components/ResearchPanel.tsx (new)
src/apps/episteme/components/ConflictsPanel.tsx (new)
src/apps/episteme/components/KnowledgeGraph.tsx (new)
src/apps/episteme/App.tsx                     (add Research/Graph/Conflicts panel tabs)
src/apps/episteme/server.ts                   (add unified_search, detect_gaps handlers)
src/apps/episteme/agent.ts                    (register CitationPlugin; schedule contradiction scan)
package.json                                  (add react-force-graph)
```
