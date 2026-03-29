# Assessment: ShellPlugin
**File:** src/plugins/ShellPlugin.ts
**Reviewed:** 2026-03-28
**Risk level:** Medium

## Bug Fixes
- [x] `executeTool` returns `undefined` for unknown tool names implicitly, but does not explicitly `return undefined` (line 46–50): The convention per `CLAUDE.md` plugin docs is to explicitly `return undefined` for unknown names so other plugins can handle them. Currently the function returns `undefined` implicitly only when `name !== "run_shell"`, which works but is not explicit. Add an explicit `return undefined` after the `if` block.
- [x] `proc.exitCode` read before `await proc.exited` resolves (lines 77–87): `proc.exitCode` is read immediately after `await proc.exited`, but the order is: stdout/stderr are awaited via `Promise.all`, then `proc.exited` is awaited separately. If `proc.exited` itself resolves before the streams are fully drained, `exitCode` could still be `null`. The safer pattern is to await `proc.exited` first (or include it in the `Promise.all`) before reading `exitCode`.

## Refactoring / Code Quality
- [x] `ALLOWED_COMMANDS` set is iterated to a string twice (lines 20–21, 30): `[...ALLOWED_COMMANDS].join(", ")` is computed separately in `getSystemPromptFragment` and in the `description` field of `getTools`. Extract a single module-level constant `const ALLOWED_COMMANDS_LIST = [...ALLOWED_COMMANDS].join(", ")` and reuse it in both places.
- [x] `executeTool` parameter typed as `args: any` (line 46): The `AgentPlugin` interface declares `executeTool` with `args: Record<string, unknown>`. The implementation should match: `args: Record<string, unknown>`. This also makes `args.command` require a cast or narrowing; narrow with `typeof args.command === "string"` before passing to `runShell`.
- [x] No guard for missing `args.command` in `executeTool` (line 48): If the LLM omits the `command` field, `args.command` is `undefined` and `runShell` receives `undefined`. `runShell` calls `.trim()` on it and will throw a runtime error. Add a check: if `typeof args.command !== "string"` return an error result rather than crashing.
- [ ] ~~`cwd` field is set but never validated (line 13–16)~~: **Skipped** — Plugin constructors must not do I/O per project conventions (CLAUDE.md). Validating `cwd` at construction time requires a filesystem check, which violates that rule. The error is already caught gracefully in `runShell`'s try/catch.

## Security
- [x] Path traversal via arguments is partially mitigated but `cat`/`head`/`tail` can read arbitrary files (lines 4–8, 71): Applied conservative fix — removed `env` and `printenv` from `ALLOWED_COMMANDS` (the highest-risk commands). `cat`, `head`, `tail`, `find`, `grep` retained as they are in scope for the plugin's stated read-only filesystem purpose.
- [x] `env` and `printenv` expose all environment variables (lines 6–7): Removed `env` and `printenv` from `ALLOWED_COMMANDS`.
- [x] No output sanitisation before returning to the LLM (lines 83–87): Added ANSI escape sequence stripping via `ANSI_ESCAPE_RE` regex applied to both stdout and stderr before truncation.

## Performance
- [x] `stdout` and `stderr` streams silently truncate without indication (lines 83–87): Added `\n[output truncated]` suffix when output exceeds the 4096/1024 byte caps.

## Consistency / Style Alignment
- [x] `executeTool` signature does not match the interface (line 46): Changed `args: any` to `args: Record<string, unknown>` and return type from `Promise<any>` to `Promise<unknown>`.
- [x] Plugin name `"Shell"` (line 11) does not match the class name `ShellPlugin`: No change needed — assessment noted this is consistent with the naming convention (class name minus `Plugin` suffix). Item closed as non-issue.
- [x] Logger tag uses string literal `"Shell"` (line 67): Changed to `this.name` for maintainability.

## Notes
- The security concerns around `cat`, `find`, `env`, and `printenv` are the most significant issues. If any of these commands are invoked by a compromised or hallucinating LLM, sensitive data (API keys, tokens from the environment, arbitrary file contents) can be exfiltrated through the normal tool-result channel. Reviewers of `BaseAgent` and any orchestration layer should be aware that `ShellPlugin` has a broader read surface than the "read-only" label implies.
- The `cwd` constraint is enforced only as the working directory for `Bun.spawn`, not as a path restriction on arguments, so file-reading commands are not actually sandboxed to `cwd`.
