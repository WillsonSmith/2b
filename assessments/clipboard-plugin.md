# ClipboardPlugin Assessment

## Module Overview

`ClipboardPlugin` exposes macOS clipboard read and write capabilities to the agent as a pair of tools. It uses the native macOS command-line utilities `pbpaste` (read) and `pbcopy` (write) via Bun's `spawn` API, making it a thin, zero-dependency bridge between the agent's tool-call system and the system clipboard. The plugin is intentionally macOS-only and has no cross-platform fallback.

## Interface / Exports

### `class ClipboardPlugin implements AgentPlugin`

| Member | Signature | Purpose |
|---|---|---|
| `name` | `string = "Clipboard"` | Plugin identifier |
| `getSystemPromptFragment()` | `() => string` | Injects instructions telling the LLM when to use clipboard tools |
| `getTools()` | `() => ToolDefinition[]` | Returns two tool definitions: `read_clipboard` and `write_clipboard` |
| `executeTool(name, args)` | `async (name: string, args: any) => Promise<any>` | Dispatches to the appropriate clipboard implementation |

No `onInit`, `getContext`, `onMessage`, or `getMessages` hooks are implemented.

## Configuration

No constructor arguments. No environment variables. The only external dependency is the macOS userland: `pbpaste` and `pbcopy` must be available in `PATH` (they are standard on macOS, located at `/usr/bin/pbpaste` and `/usr/bin/pbcopy`).

## Data Flow

### Read path
```
Agent tool call: read_clipboard {}
  → Bun.spawn(["pbpaste"], { stdout: "pipe" })
  → Response(proc.stdout).text()
  → await proc.exited
  → return { content: "<clipboard text>" }
```

### Write path
```
Agent tool call: write_clipboard { text: "..." }
  → Bun.spawn(["pbcopy"], { stdin: new Blob([args.text]) })
  → await proc.exited
  → return { success: true, characters_written: <number> }
```

Data enters from the macOS clipboard (via `pbpaste` stdout) or from the agent's tool call arguments (via `pbcopy` stdin). No in-memory transformation is applied.

## Code Paths

### `read_clipboard`
1. Logs at debug level.
2. Spawns `pbpaste` with `stdout: "pipe"` and `stderr: "ignore"`.
3. Reads the stdout stream as text via `new Response(proc.stdout).text()`.
4. Awaits process exit.
5. Returns `{ content }`.

No error handling around the spawn or text read. If `pbpaste` fails (non-macOS system, process error), the method will likely reject with an unhandled promise rejection that propagates to `BaseAgent`'s tool dispatch.

### `write_clipboard`
1. Logs at debug level, truncating the text to 50 characters in the log message.
2. Spawns `pbcopy` with the text as stdin via `new Blob([args.text])`.
3. Both stdout and stderr are ignored.
4. Awaits process exit.
5. Returns `{ success: true, characters_written: args.text.length }`.

`characters_written` reports JavaScript string `.length` (UTF-16 code units), which differs from byte count for multi-byte characters. No error handling around the spawn or exit code.

## Helper Functions / Internals

None. The plugin has no private methods or helpers.

## Error Handling

There is no explicit error handling in either tool implementation. Neither the spawn call nor the `proc.exited` await is wrapped in try-catch. If the underlying process fails:
- For `read_clipboard`: the promise rejection propagates up through `executeTool` and is caught by `BaseAgent`'s plugin dispatch error boundary.
- For `write_clipboard`: an exit code other than 0 is not checked — the method always returns `{ success: true }` regardless of whether `pbcopy` actually wrote to the clipboard.

## Integration Context

**Registered in:** `src/agents/sub-agents/createSystemAgent.ts` as part of the system operations sub-agent alongside `ShellPlugin`, `FileIOPlugin`, and `CodeSandboxPlugin`.

```typescript
// createSystemAgent.ts
new HeadlessAgent(llm, [new ShellPlugin(), new FileIOPlugin(), new ClipboardPlugin(), new CodeSandboxPlugin()], ...)
```

**Depends on:**
- `src/core/Plugin.ts` — `AgentPlugin` and `ToolDefinition` types
- `src/logger.ts` — debug logging
- macOS system utilities: `pbpaste`, `pbcopy`

**Used by:** The orchestrator's `system_agent` sub-agent. The orchestrator delegates clipboard tasks to this sub-agent rather than calling the plugin directly.

## Observations / Notes

1. **macOS-only:** There is no platform guard (`process.platform !== "darwin"`). Running on Linux or Windows will silently fail at spawn time because `pbpaste`/`pbcopy` do not exist on those platforms. A meaningful error message or early check would improve robustness.

2. **`write_clipboard` always returns `success: true`:** The exit code of `pbcopy` is never inspected. If the process exits non-zero (e.g., out of memory, permission issue), the caller is told the write succeeded.

3. **`characters_written` is misleading for non-ASCII text:** It reports `args.text.length` (UTF-16 code units) rather than byte count. A string containing emoji or CJK characters will undercount bytes.

4. **No size limits:** There is no cap on how much text can be written to or read from the clipboard. An extremely large clipboard (e.g., a multi-megabyte document) would be returned in full to the LLM context, potentially exceeding context window limits.

5. **`await proc.exited` order (read path):** The stdout is read before `proc.exited` is awaited. Because `new Response(proc.stdout).text()` internally consumes the stream, this is safe — the text will be available even if the process has already exited by the time `.text()` resolves. However, the reversed ordering (read before exit) is worth noting for anyone auditing the spawn lifecycle.

6. **Minimal surface area:** The plugin is deliberately small and does exactly one thing per tool. This is a good design for testability and composability.
