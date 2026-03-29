# Assessment: util
**File:** src/agents/util.ts
**Reviewed:** 2026-03-28
**Risk level:** Low

## Bug Fixes
- [x] **`flexibleMode` regex over-matches at string start** (line 7): The pattern `(?:^|<think>)[\s\S]*?<\/think>` matches from the zero-width `^` anchor, so a string like `"orphaned content</think>"` — where there is no opening `<think>` tag — will have `orphaned content` stripped. The intent (strip content that begins at position 0 without an opening tag) may be valid, but the current regex silently removes leading text up to the first `</think>` even when that text is not a think block. If the caller guarantees the string always contains well-formed or partially-formed think blocks, add a comment documenting that contract. If not, tighten the pattern to `(?:^[\s\S]*?<\/think>|<think>[\s\S]*?<\/think>)` and add a test for the edge case.

## Refactoring / Code Quality
- [x] **No return type annotation** (line 1): `removeThinkTags` returns `string` but the signature omits the annotation. Add `: string` to make the contract explicit and catch future refactors that accidentally change the return type.
- [x] **No JSDoc for `flexibleMode` parameter** (line 1): The two modes have meaningfully different behaviour (strict tag pair vs. "also strip leading untagged think content"), but no documentation exists at the call site. Add a short JSDoc block explaining both modes so callers understand when to use each.
- [ ] **SKIPPED — Function is exported but never imported** (line 1): A codebase-wide search finds no `import … from … util` references anywhere in `src/`. The export is dead code. Either wire it into the module that needs it (likely `src/core/BaseAgent.ts`, which handles `<think>` tag extraction per the architecture docs) or remove the file. *Skipped: wiring into `BaseAgent.ts` is outside the target module's scope per update-module rules.*

## Security
No issues found.

## Performance
No issues found.

## Consistency / Style Alignment
- [ ] **SKIPPED — File location inconsistent with shared utility placement** (`src/agents/util.ts`): All other cross-cutting utilities (`deviceSelector.ts`, `stream-tts.ts`) live in `src/utils/`. A general string-transformation helper like `removeThinkTags` belongs there, not in `src/agents/`. Move to `src/utils/util.ts` (or `src/utils/stringUtils.ts`) and update any future imports accordingly. *Skipped: moving the file would change its import path; deferred until the dead-code item above is resolved and a consumer exists to verify the new path.*

## Notes
- This is the smallest module in the codebase (14 lines, one exported function). Its primary risk is that it is currently unreachable dead code — the logic exists but nothing calls it.
- The architecture docs for `BaseAgent` note that `<think>` tag extraction is handled by `BaseAgent` for UI display. This utility may have been written as a helper for that purpose but was never wired in, or was superseded by inline logic. Reviewers of `src/core/BaseAgent.ts` should check whether `removeThinkTags` duplicates or conflicts with whatever think-tag handling exists there.
