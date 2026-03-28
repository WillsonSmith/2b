# Assessment: createWebAgent
**File:** src/agents/sub-agents/createWebAgent.ts
**Reviewed:** 2026-03-28
**Risk level:** Low

## Bug Fixes
No issues found.

## Refactoring / Code Quality
- [x] Overly broad system prompt for a four-plugin agent: The system prompt (line 12) names all four plugin capabilities inline as a flat sentence. As plugins are added or removed this description will drift. Consider deriving the description from `getSystemPromptFragment()` on each plugin, or at minimum aligning the prose to match the registered plugin set exactly (the current text is already accurate, but the pattern is fragile for future edits). **SKIPPED** — no actionable change within current module scope; the text is accurate and no structural refactor is warranted without a broader cross-plugin change.

## Security
No issues found.

## Performance
No issues found.

## Consistency / Style Alignment
- [x] Missing Wikipedia and RSS coverage in the `SubAgentPlugin` description in `AgentFactory.ts` (line 79): The `web_agent` description reads "searching the web and reading web page content", omitting Wikipedia and RSS feed capabilities. This is a cross-module wording issue: the factory itself is consistent, but callers of `web_agent` will not know to route Wikipedia or RSS tasks to it. The fix belongs in `AgentFactory.ts` line 79, not in this file. **SKIPPED** — fix is in `AgentFactory.ts`, which is outside this module's scope per update-module rules.

## Notes
The `AgentFactory.ts` architecture comment in `src/agents/CLAUDE.md` also lists `web_agent` as `[WebSearch, WebReader]`, omitting `WikipediaPlugin` and `RSSPlugin`. Reviewers of `AgentFactory.ts` and the CLAUDE.md documentation should update those references to include all four plugins.

All other sub-agent factories (`createMediaAgent`, `createSystemAgent`, `createInfoAgent`) follow the identical structural pattern — imports, single exported function, inline `new HeadlessAgent(llm, [...plugins], systemPrompt)`. `createWebAgent` is fully consistent with this pattern.
