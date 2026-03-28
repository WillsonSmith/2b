# Assessment: MemoryProvider
**File:** src/memory/MemoryProvider.ts
**Reviewed:** 2026-03-28
**Risk level:** Low

## Bug Fixes
- [x] `MemoryQuery` is entirely unused: The `MemoryQuery` interface (lines 9–12) is defined but never referenced by `MemoryProvider` or any implementation. This means the `limit` parameter it declares is not surfaced through the provider contract — callers must pass `limit` directly to `getRecentContext` and `getRecentMessages` instead. If the intent was to make queries composable, `MemoryProvider` methods should accept `MemoryQuery` rather than bare `limit?: number`. **Applied conservatively**: added a TODO comment documenting the gap and the intended migration path. Restructuring method signatures would be a breaking API change deferred to when a concrete backend is built.

## Refactoring / Code Quality
- [x] Union return types reduce predictability: Both `getRecentContext` and `getRecentMessages` (lines 27–32) declare `Promise<T> | T` return types, forcing every caller to `await` defensively even for synchronous implementations. Standardised to `Promise<T>` only so callers have a consistent contract and implementations can simply wrap synchronous values in `Promise.resolve`.
- [x] `MemoryItem` is unused as an interface contract: `MemoryItem` (lines 1–7) is not referenced in any `MemoryProvider` method signature. `addMessage` takes raw primitives (role, content, interactionType) instead of accepting a `MemoryItem`. **Applied conservatively**: `MemoryItem` retained as-is; `addMessage` signature left unchanged. Restructuring to `addMessage(item: Omit<MemoryItem, ...>)` would be a larger scope change deferred to when an implementation is written. JSDoc added to note the relationship.
- [x] `addMessage` return type union: `addMessage` (line 18–22) also uses `Promise<void> | void`, the same inconsistency as the query methods — unified to `Promise<void>`.
- [x] `interactionType` has no default documented: The `interactionType` parameter on `addMessage` (line 21) is optional, but the interface does not state what default a conforming implementation should use. Added JSDoc specifying `'direct'` as the expected default with a list of common values.
- [x] Duplicate JSDoc comment block: Lines 38–46 in `MemoryPlugin.ts` show a duplicate doc block — **skipped**: outside the target module's scope per skill rules.

## Security
No issues found.

## Performance
No issues found.

## Consistency / Style Alignment
- [x] `role` union type is duplicated: The type `"user" | "agent" | "assistant" | "system"` is spelled out on both `MemoryItem.role` (line 3) and `addMessage`'s `role` parameter (line 19). Extracted as `export type MemoryRole` and referenced in both places.
- [x] `getRecentMessages` return shape uses an inline anonymous type: **Skipped** — `Message` from `src/core/types.ts` has `role: "user" | "assistant" | "system"` and does not include `"agent"`. Substituting it would cause a type-incompatibility with `MemoryRole`. The inline `{ role: string; content: string }[]` is retained.
- [x] No export of `MemoryQuery` consumers: Added a `// TODO` comment above `MemoryQuery` clarifying it is not yet wired into any method signature and describing the intended migration path.

## Notes
Per `src/memory/CLAUDE.md`, `MemoryProvider` is a **legacy/reference interface** — no concrete implementation exists and `MemoryPlugin` does not use it. Any refactoring here is low-urgency. The most practical near-term step is using `MemoryProvider` as the type contract when a persistent backend is eventually added to `MemoryPlugin`. The `MemoryItem.interactionType` field is more expressive than what `MemoryPlugin.onMessage` currently tracks (which only supports `"user" | "assistant" | "system"` roles with no interaction type). Implementors bridging the two should be aware of this impedance mismatch.
