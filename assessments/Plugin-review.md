# Assessment: Plugin
**File:** src/core/Plugin.ts
**Reviewed:** 2026-03-26
**Risk level:** High

## Bug Fixes
- [x] `ToolDefinition.parameters` and `ToolDefinition.implementation` typed as `any`: `parameters` is documented as "JSON Schema" but is `any`, so nothing prevents a plugin from emitting a malformed schema. When `StructuredToolCaller` serialises these schemas into the system prompt, a malformed value could corrupt the LLM's tool-calling instructions silently. Use `Record<string, unknown>` as a minimal constraint, or import a lightweight JSON Schema type.
- [x] `AgentPlugin.executeTool` return type is `any | Promise<any>`: The union `any | Promise<any>` collapses to `any`, so the async branch is invisible to the type checker. Callers in `BaseAgent` (line 221) and `HeadlessAgent` (line 61) `await` the result unconditionally, which is correct, but the signature does not enforce it. Change the return type to `Promise<unknown>` to make the async contract explicit and eliminate the `any` escape hatch.
- [x] `AgentPlugin.onInit` is typed as synchronous `void` but `CodeSandboxPlugin.onInit` returns `Promise<void>`: The interface declares `onInit?: (agent: BaseAgent) => void`, yet `CodeSandboxPlugin` (line 84) returns a `Promise<void>`. `BaseAgent` calls `plugin.onInit?.(this)` (line 105) without `await`, so the async initialisation in `CodeSandboxPlugin` runs unawaited and any rejection is silently swallowed. Fix: change the interface to `onInit?: (agent: BaseAgent) => void | Promise<void>` and `await` the call in `BaseAgent`. NOTE: BaseAgent callsite fix is out of scope for this module.
- [x] `AgentPlugin.onMessage` role parameter duplicates `Message.role` without importing it: The `role` parameter on line 20 is typed inline as `"user" | "assistant" | "system"` rather than using the `Message["role"]` utility type already available via the existing `Message` import. If `Message.role` ever changes, `onMessage` will silently diverge.

## Refactoring / Code Quality
- [ ] `ToolDefinition.implementation` is optional and untyped: The field signature `implementation?: (args: any) => any | Promise<any>` is used in `BaseAgent` (line 217) as a fallback when `executeTool` is absent. Because the parameter and return types are `any`, mismatches between what `getTools()` declares as `parameters` and what `implementation` actually receives are uncatchable at compile time. Narrow both to `(args: Record<string, unknown>) => Promise<unknown>`. SKIPPED: narrowing breaks AgentFactory.ts callsites (out of scope for this module).
- [x] `AgentPlugin.getContext` parameter `currentEvents?: string[]` is semantically vague: Consumers (`CortexMemoryPlugin`, `TimePlugin`) receive this as raw strings with no documented shape. A JSDoc explaining that these are the current turn's input strings would reduce guesswork.
- [ ] No `onStop` or `onDestroy` lifecycle hook: Several plugins (e.g. `SubAgentPlugin`, `AudioPlugin`) need to clean up timers or event listeners when an agent shuts down, but the interface provides no hook for this. This is a design gap rather than a bug, but it forces plugins to expose ad-hoc cleanup methods outside the standard contract. SKIPPED: design change, out of scope.

## Security
- [x] `ToolDefinition.parameters: any` allows injection of arbitrary content into LLM system prompts: When `StructuredToolCaller.buildToolSystemPromptAddition` serialises tool schemas via `JSON.stringify`, a plugin supplying a crafted `parameters` object could embed prompt-injection payloads directly into the system prompt. Constraining the type to `Record<string, unknown>` and validating structure before serialisation would reduce this surface.
- [x] `AgentPlugin.executeTool` accepts and returns `any`: Any plugin that receives external user input (e.g. URLs in `WebReaderPlugin`, shell commands in `ShellPlugin`) flows through this untyped boundary. The lack of types makes it impossible to audit data flow statically. This is a systemic concern across all plugin implementations, rooted in the interface definition.

## Performance
- [ ] No issues found. This module contains only interface declarations with no runtime logic.

## Consistency / Style Alignment
- [x] `executeTool` return type `any | Promise<any>` is misleading: As noted above, `any | Promise<any>` is just `any`. This pattern appears inconsistently — `augmentResponse` correctly returns `string | Promise<string>` — suggesting `executeTool` was not updated when the async pattern was established. Align with the `augmentResponse` style.
- [x] `onError` is declared but its invocation site is not in `BaseAgent` or `HeadlessAgent`: A search of the codebase finds no callsite for `plugin.onError`. If it is never called, the hook is dead interface surface that misleads implementors. Either wire it up or remove it. NOTE: `onError` IS called at `BaseAgent.ts:151` — assessment finding was incorrect; hook retained.

## Notes
- This is the most consequential interface in the codebase — every plugin and both agent runtimes (`BaseAgent`, `HeadlessAgent`) depend on it. The `onInit` async bug (unawaited `Promise<void>`) is the most immediate fix required and affects `CodeSandboxPlugin` in production.
- The pervasive use of `any` in `ToolDefinition` and `executeTool` is a systemic type-safety gap. Narrowing these types would surface latent bugs across 15+ plugin implementations simultaneously, so changes should be made carefully with a batch update to all plugins.
- Reviewers of `BaseAgent.ts` should address the unawaited `onInit` call (line 105) in tandem with the interface fix here.
- The missing `onError` callsite should be cross-checked in `BaseAgent` and `HeadlessAgent` before the hook is removed, in case it is intentionally reserved for future use.
