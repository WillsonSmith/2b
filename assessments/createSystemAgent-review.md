# Assessment: createSystemAgent
**File:** src/agents/sub-agents/createSystemAgent.ts
**Reviewed:** 2026-03-28
**Risk level:** Low

## Bug Fixes
- No issues found.

## Refactoring / Code Quality
- [x] System prompt omits confirmation of plugin capabilities: The system prompt on line 12 states the agent can "run shell commands, read and write files, access the clipboard, and execute code in a sandbox", but `ShellPlugin` is explicitly read-only (no write commands, no shell operators). The description "run shell commands" without qualification may cause the LLM to attempt non-permitted operations and receive repeated refusals. Consider aligning the wording to "run read-only shell commands" to match the actual capability exposed by `ShellPlugin`.
- [x] System prompt does not mention constraint on code sandbox input: `CodeSandboxPlugin` accepts tasks described in plain language, not raw code. The system prompt says "execute code in a sandbox" which may mislead the LLM into trying to pass raw Python. The other sub-agent prompts (e.g. `createWebAgent.ts`) are explicit about tool use patterns; bringing `createSystemAgent` to the same level of precision would reduce misuse.

## Security
- No issues found. Plugin-level security (allowlist enforcement in `ShellPlugin`, container isolation in `CodeSandboxPlugin`, working-directory restriction in `FileIOPlugin`) is handled downstream. The factory function itself introduces no additional attack surface.

## Performance
- No issues found. The factory is a one-time construction call with no I/O or computation.

## Consistency / Style Alignment
- [x] Import order differs from peer factories: `createMediaAgent.ts`, `createWebAgent.ts`, and `createInfoAgent.ts` all import `HeadlessAgent` first, then `LLMProvider`, then plugins in usage order. `createSystemAgent.ts` follows the same pattern, which is consistent. However, the plugin import block (lines 3–6) lists `ShellPlugin`, `FileIOPlugin`, `ClipboardPlugin`, `CodeSandboxPlugin` — a different logical grouping order than the array on line 11. This is a minor readability nit; the array already reflects the logical "shell → file → clipboard → sandbox" progression, so the import order matches and no change is strictly required.

## Notes
- `CodeSandboxPlugin` implements `onInit` for eager image pre-pull when running under `BaseAgent`, but `HeadlessAgent` does not call `onInit`. This means the container image is never pre-pulled when `createSystemAgent` is used as a sub-agent — the first `execute_code` call will trigger a pull and may be slow. This is a cross-module concern between `HeadlessAgent` and `CodeSandboxPlugin`; reviewers of either module should be aware. No change is required in `createSystemAgent.ts` itself.
- `ClipboardPlugin` uses macOS-specific `pbpaste`/`pbcopy` binaries. This is consistent with the project's macOS-first posture (also reflected in `CodeSandboxPlugin`'s Apple Container detection), but the system prompt on line 12 does not warn the LLM that clipboard access is platform-specific. This is low risk for current deployment but worth noting if cross-platform support is ever considered.
