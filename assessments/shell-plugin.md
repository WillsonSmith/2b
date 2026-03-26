# ShellPlugin Assessment

## Module Overview

ShellPlugin provides a sandboxed, read-only shell execution capability for agents. It allows an agent to run a curated allowlist of Unix commands (ls, git, grep, cat, etc.) against the filesystem without being able to write files, install packages, or modify system state. It exists to let an agent inspect its environment — directory contents, git history, file text, running processes — without exposing destructive operations.

The plugin enforces two layers of safety: an allowlist check on the base command, and the use of `Bun.spawn` (rather than a shell interpreter) so that operators like `|`, `&&`, `>`, and `;` are never interpreted.

## Interface / Exports

```typescript
export class ShellPlugin implements AgentPlugin
```

**Constructor**

```typescript
constructor(cwd: string = process.cwd())
```

Sets the working directory for spawned processes. Defaults to the Node/Bun process working directory. The value is stored and passed to every `Bun.spawn` call as `cwd`.

**Implemented AgentPlugin hooks**

| Hook | Returns |
|---|---|
| `getSystemPromptFragment()` | Instructions telling the LLM which commands are permitted and that shell operators are unsupported |
| `getTools()` | One tool definition: `run_shell` |
| `executeTool(name, args)` | Delegates `run_shell` to `this.runShell(args.command)` |

**Tool: `run_shell`**

- **Parameter**: `command` (string, required) — full command string including flags, e.g. `"git log --oneline -10"`.
- **Returns**: `{ stdout: string; stderr: string; exitCode: number }`

## Configuration

- **`cwd` constructor argument**: Sets the working directory for all spawned processes. Defaults to `process.cwd()`.
- **No environment variables** are required or read by this plugin.
- **`ALLOWED_COMMANDS` constant** (module-level `Set<string>`): `ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `echo`, `date`, `git`, `grep`, `find`, `which`, `env`, `printenv`, `uname`, `df`, `du`, `ps`, `whoami`, `hostname`. This set is frozen at module load time and shared across all instances.

## Data Flow

```
LLM calls run_shell { command: "git log --oneline -5" }
  → executeTool("run_shell", { command })
    → runShell(command)
      → trim + split on whitespace → parts = ["git", "log", "--oneline", "-5"]
      → check parts[0] against ALLOWED_COMMANDS
        if rejected → return { stdout: "", stderr: "Command '...' not permitted", exitCode: 1 }
      → logger.debug("Shell", `run_shell: ${trimmed}`)
      → Bun.spawn(parts, { cwd, stdout: "pipe", stderr: "pipe" })
      → Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      → await proc.exited
      → return { stdout: stdout.slice(0, 4096), stderr: stderr.slice(0, 1024), exitCode }
```

## Code Paths

### Happy path — allowed command

1. `executeTool` receives `name === "run_shell"` and calls `runShell(args.command)`.
2. `runShell` trims and splits the command string on whitespace.
3. `parts[0]` is the base command. It is checked against `ALLOWED_COMMANDS`.
4. A debug log entry is written.
5. `Bun.spawn` is called with the parts array and the configured `cwd`. No shell is involved.
6. Both `stdout` and `stderr` streams are read concurrently via `Promise.all`.
7. `proc.exited` is awaited.
8. `stdout` is truncated to 4096 characters; `stderr` to 1024 characters.
9. The object `{ stdout, stderr, exitCode }` is returned to the LLM.

### Rejected command

If `parts[0]` is not in `ALLOWED_COMMANDS`, the function returns immediately with `exitCode: 1` and a human-readable `stderr` listing the allowed commands. `Bun.spawn` is never reached.

### Process spawn error

If `Bun.spawn` throws (e.g., the binary is not on PATH), the catch block returns `{ stdout: "", stderr: e.message, exitCode: 1 }`. The error is not re-thrown; the LLM receives a structured failure response.

### Unknown tool name

If `executeTool` is called with a name other than `"run_shell"`, the function returns `undefined` (implicit). The plugin does not throw for unrecognised tool names.

## Helper Functions / Internals

### `private async runShell(command: string)`

The sole implementation method. Encapsulates all splitting, allowlist checking, spawning, I/O collection, and output truncation. Not exported.

### `ALLOWED_COMMANDS` (module-level constant)

A `Set<string>` declared outside the class at module scope. Because it lives outside the class it cannot be overridden per-instance. The same reference is used in both `getSystemPromptFragment()` (to inform the LLM) and `runShell` (to enforce at runtime), keeping the two in sync automatically.

## Error Handling

| Scenario | Handling |
|---|---|
| Disallowed base command | Synchronous early return, `exitCode: 1`, no spawn |
| `Bun.spawn` throws | Caught; error message placed in `stderr`, `exitCode: 1` |
| Unknown tool name | Returns `undefined` silently |

Errors are never re-thrown to the caller. All failure modes are expressed through the structured `{ stdout, stderr, exitCode }` return shape so the LLM can reason about what went wrong.

## Integration Context

ShellPlugin is registered exclusively in the **system sub-agent** (`src/agents/sub-agents/createSystemAgent.ts`), alongside `FileIOPlugin`, `ClipboardPlugin`, and `CodeSandboxPlugin`. The system agent is a `HeadlessAgent` with the persona "system operations specialist."

The system sub-agent is surfaced to the main orchestrator (CortexAgent) as a tool via `SubAgentPlugin`. The end-to-end call chain is:

```
User → CortexAgent (orchestrator)
  → SubAgentPlugin.executeTool("system_agent", { task })
    → HeadlessAgent.ask(task)
      → ShellPlugin.executeTool("run_shell", { command })
```

`BaseAgent.act()` wires `plugin.executeTool` as the `implementation` of each `ToolDefinition` and emits a `tool_call` event, allowing the orchestrator to observe all tool invocations.

## Observations / Notes

- **No shell interpretation**: Using `Bun.spawn(parts, ...)` rather than `Bun.$\`...\`` or `spawn("sh", ["-c", command])` is the key security design. Shell operators in the command string are silently ignored because the argument array never enters a shell. The source code comments this explicitly.
- **Output truncation is silent**: `stdout` is capped at 4096 bytes and `stderr` at 1024 bytes, with no ellipsis or truncation notice appended. For large outputs from commands like `cat` on a big file, the LLM receives incomplete data with no signal that content was cut.
- **Whitespace splitting is naive**: A command like `cat "file with spaces.txt"` is split into `["cat", '"file', 'with', 'spaces.txt"']`, which is incorrect. There is no shell-quoting parser, so filenames containing spaces cannot be addressed.
- **`cwd` is fixed at construction time**: There is no per-call override. The agent cannot change its working directory between calls.
- **`proc.exitCode ?? 0`**: If `proc.exitCode` is `null` after `proc.exited` resolves, the exit code is reported as `0`. This is a defensive fallback that could mask genuinely abnormal termination.
- **`echo` is allowed**: While harmless in terms of disk writes, it can probe environment variables or confirm injection vectors. The risk is low since no shell expansion occurs.
