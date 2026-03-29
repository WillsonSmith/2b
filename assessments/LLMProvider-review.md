# Assessment: LLMProvider
**File:** src/providers/llm/LLMProvider.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] `chat` parameter type is `Message[] | any[]`: The union type `Message[] | any[]` on line 12 defeats TypeScript type-checking for the `messages` parameter — `any[]` subsumes `Message[]` and makes the entire argument effectively untyped. This should be `Message[]` only, matching the concrete implementation in `LMStudioProvider`.

## Refactoring / Code Quality
- [x] `schema` typed as `any` (line 14): The `schema` parameter is typed as `any`, which erases type safety for callers. A generic type parameter (e.g., `TSchema = unknown`) or a shared `LLMSchema` type would improve correctness. At a minimum it should be `unknown` to force callers to narrow before use.
- [x] `getEmbedding` has no error contract: The interface declares `getEmbedding(text: string): Promise<number[]>` but there is no documentation or contract for what happens on empty input, oversized input, or when the embedding model is unavailable. A JSDoc comment with documented edge cases would help implementors stay consistent.
- [x] Missing JSDoc on the interface itself: Neither `LLMProvider` nor `ChatResponse` has any documentation. Given that this is the primary extension point for adding new LLM backends, even a one-line description on each member would reduce the chance of incorrect implementations.

## Security
No issues found.

## Performance
No issues found.

## Consistency / Style Alignment
- [x] `ChatResponse.nonReasoningContent` vs `response`: The `ChatResponse` interface (lines 4–8) exposes both `response` and `nonReasoningContent` with no clear documented distinction. This creates ambiguity for future implementors — the concrete `LMStudioProvider` populates them differently depending on whether tool calls occurred. A brief JSDoc comment on each field clarifying the intended semantic difference is needed.
- [x] Import uses `.ts` extension explicitly (line 1–2): The imports end with `.ts` (`../../core/types.ts`, `../../core/Plugin.ts`). This is consistent with the rest of the codebase, but is worth noting as a project-wide convention that should be maintained in any new provider files.

## Notes
- This file is the sole interface contract for all LLM backends. Any change here (e.g., adding a new parameter to `chat`) requires coordinated updates in every implementor (`LMStudioProvider`, any future providers) and all call sites across `BaseAgent`, `CortexAgent`, `HeadlessAgent`, and the sub-agent factories.
- The `schema` parameter is passed through to `LMStudioProvider` as an `LLMStructuredPredictionSetting`, which is an LMStudio-SDK-specific type. If a second provider is ever added (e.g., OpenAI), the `schema` type will need to be abstracted at the interface level, or the parameter will need to be split into provider-neutral options.
