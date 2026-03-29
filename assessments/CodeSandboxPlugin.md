# Assessment: CodeSandboxPlugin
**File:** src/plugins/CodeSandboxPlugin.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [ ] `onInit` does not await `ensureInitialized()` (line 87): `this.ensureInitialized()` is called without `await`, so initialization errors are silently swallowed. Change to `await this.ensureInitialized()` — or at minimum attach a `.catch` handler — so failures surface rather than disappearing.
- [ ] `truncate` may produce invalid UTF-8 (lines 283–284): `Buffer.from(text).slice(0, maxBytes).toString("utf8")` can split a multi-byte character mid-codepoint, yielding a replacement character or garbled output. Use `Buffer.from(text).subarray(0, maxBytes)` then decode with the `'utf8'` codec and a replacement strategy, or walk back to the last complete codepoint boundary before slicing.
- [ ] `proc.stdout` / `proc.stderr` consumed after `proc.exited` resolves (lines 207–210): In Bun, reading stdout/stderr via `new Response(proc.stdout).text()` after the process has already exited can race against stream closure. Read both streams concurrently with `proc.exited` using `Promise.all` on all three at once, or buffer through a `ReadableStream` collected in parallel before the race.
- [ ] `generateCode` has no timeout (lines 265–278): If LM Studio is slow or hangs, code generation blocks indefinitely. The per-execution `timeout` (line 162) only covers the container run, not the upstream LLM call. Add an `AbortSignal` or a `Promise.race` wrapping `generateCode` with a reasonable cap (e.g. `MAX_TIMEOUT_MS`).

## Refactoring / Code Quality
- [ ] `executeTool` signature mismatch (line 136): The method signature uses `args: any` but the `AgentPlugin` interface (Plugin.ts line 22) declares `args: Record<string, unknown>`. Align the signature to `args: Record<string, unknown>` for type safety.
- [ ] `buildRunArgs` inlines the input_data value directly into the `-e` flag (lines 243, 261): The value is passed as a single string element in the array, which is correct for `Bun.spawn` (no shell interpolation). Add a comment making this explicit so future maintainers don't refactor it to shell string concatenation, which would introduce injection.
- [ ] `initPromise` is never reset on failure (lines 44, 51–56): If `initialize()` throws, `initPromise` holds a rejected Promise. Subsequent calls to `ensureInitialized()` will immediately re-reject without retrying. Either reset `this.initPromise = null` in a `.catch` block so initialization can be retried, or document that the plugin must be recreated on failure.
- [ ] `detectRuntime` is a module-level free function (lines 15–21): It accesses `process.platform` and spawns a subprocess but is not testable in isolation. Consider making it a private static method or injectable to allow unit testing without spawning real processes.
- [ ] `stripCodeFences` regex only handles one fence at the start and one at the end (lines 33–37): If the model wraps the code in additional whitespace-only lines between the fence and the code body, or emits a fence mid-response, the strip will be incomplete. Consider a more robust extraction that searches for the first ``` block and extracts its body.

## Security
- [ ] `INPUT_DATA` is injected into the container environment verbatim via `-e INPUT_DATA=<value>` (lines 243, 261): Because `Bun.spawn` receives an array (not a shell string), shell injection is not possible — this is safe. However, the raw JSON value (up to 256 KB) becomes part of the container's `/proc/1/environ`, which could be read by the sandboxed process itself. This is expected behavior but worth documenting explicitly.
- [ ] Generated code is passed directly as the `-c` argument to `python` inside the container (line 185): The code originates from an LLM and is not human-controlled, but it still executes with the container user's privileges. The existing resource caps (memory, CPU, pids, read-only FS, no network) mitigate most risk; no additional fix is strictly required, but the design should be documented as a known trust boundary.

## Performance
- [ ] `new LMStudioClient()` is constructed in the plugin constructor with no connection pooling visible (line 47): If `generateCode` opens a new model handle per call (`this.lmClient.llm.model(this.codeModel)` on line 266), this may be expensive. Cache the resolved `modelClient` after first load rather than re-resolving it on every `executeTool` invocation.
- [ ] `Buffer.byteLength` is called twice on `task` — once for the size check (line 149) and once implicitly via string operations — and twice on `code` (lines 178, 181). Minor, but consolidate into a single `byteLength` call stored in a local variable per value.

## Consistency / Style Alignment
- [ ] The plugin's `name` property is `"CodeSandbox"` (line 40) but the class is `CodeSandboxPlugin`. Other plugins (e.g. `SubAgentPlugin`, `ThoughtPlugin`) use the class name without the `Plugin` suffix for `name`, so this is consistent with convention — no change needed.
- [ ] `logger.debug` is used for generated code (line 182), but all other log calls use `logger.info`. This is correct (debug is appropriate for verbose output), but verify that the project's logger actually supports a `debug` level and that it is not silently dropped in production.
- [ ] `input_data` snake_case parameter naming in TypeScript (lines 141, 227) is consistent with the JSON tool schema but inconsistent with the camelCase convention used elsewhere in the codebase. Not a blocking issue, but a note for future refactors.

## Notes
- This plugin depends on an external container runtime (`docker` or Apple Container) being available in the PATH at runtime. There is no health check or graceful degradation if neither is installed; `execute_code` will fail at container spawn time with an unhelpful OS error.
- The `LMStudioClient` import from `@lmstudio/sdk` is used only in this plugin. Reviewers of other plugins do not need to account for it.
- The 64 KB output cap (`MAX_OUTPUT_BYTES`) applies per stream (stdout and stderr separately), so total returned data can reach 128 KB plus the generated code — callers should be aware of potential response size.
