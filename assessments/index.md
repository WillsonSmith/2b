# Assessment: `index.ts`

**Files covered:**
- `index.ts`
- `src/agents/AgentFactory.ts`
- `src/agents/input-sources/CLIInputSource.ts`
- `src/cli/memory-cmd.ts`
- `src/core/CortexAgent.ts`
- `src/core/BaseAgent.ts` (entry-point interactions)
- `src/core/types.ts` (`AgentEventMap`)

---

## Step 1 — Entry Point Role and Responsibilities

`index.ts` is the CLI binary (declared via `#!/usr/bin/env bun` at line 1). It is the sole consumer of `createAgent()` and has no callers; it is instantiated directly by the OS when the user runs `2b`.

Its responsibilities are:
1. Route the `memory` subcommand before any agent is created.
2. Parse flags and positional arguments.
3. Detect execution mode (interactive vs. one-shot).
4. Eagerly consume piped stdin when necessary.
5. Create the agent, attach all display callbacks, then start it.
6. Inject the one-shot message (if any) after `agent.start()`.

These are distinct concerns co-located in a single top-level script with no class or function boundary separating them. This is acceptable for an entry point of this size but means all logic executes at module scope, making unit testing impossible without spawning a subprocess.

---

## Step 2 — Subcommand Routing

The `memory` subcommand is checked at line 10 against `rawArgs[0]` before any flag parsing:

```ts
if (rawArgs[0] === "memory") {
  const { runMemoryCommand } = await import("./src/cli/memory-cmd.ts");
  await runMemoryCommand(rawArgs.slice(1));
  process.exit(0);
}
```

**Issue — flags before subcommand are silently ignored.** `2b --quiet memory list` would fall through to flag parsing because `rawArgs[0]` is `--quiet`, not `memory`. The user gets interactive mode, not a memory listing, with no error. The documented usage shows `2b memory list` without leading flags, but a user who naturally prepends `--quiet` will be confused.

**Issue — `memory` is a hardcoded string with no extensibility point.** Adding a second subcommand requires another top-level `if` block. There is no dispatch table or router abstraction.

**Issue — dynamic import on every invocation.** `memory-cmd.ts` is imported dynamically via `await import(...)`. For the `memory` path this is fine (early exit), but it means the module is never included in a static bundle without explicit annotation. For Bun this is low-risk but worth noting.

---

## Step 3 — Flag Parsing

Flags are parsed in a manual `for` loop (lines 23–38). The loop increments `i` internally for `--model`'s value argument:

```ts
} else if (arg === "--model" || arg === "-m") {
  const next = rawArgs[++i];
  if (next) process.env.MODEL = next;
}
```

**Issue — silent skip when `--model` has no value.** If `2b --model` is the last argument, `next` is `undefined`, the `if (next)` guard swallows the error, and the agent starts with the default model. The user receives no feedback that the flag was malformed.

**Issue — `showHelp` flag is collected but `--help` is not detected during `memory` subcommand args.** If the user runs `2b memory --help`, the subcommand handler in `memory-cmd.ts` handles it correctly. But `2b --help memory` would print the top-level help and exit before ever reaching the memory handler, which is surprising but arguably acceptable.

**Issue — unrecognised flags are silently dropped.** Any flag starting with `-` that does not match a known pattern (e.g. `--verbose`, `-x`) is discarded without warning. The loop's `else if (!arg.startsWith("-"))` branch treats it as neither a flag nor a positional — it just falls through.

**Issue — `YELLOW` constant is declared after agent creation (line 92), not with the other ANSI constants (line 4).** This is a minor inconsistency; the constant is unused until `showTools` wiring, but the separation from the other color definitions is confusing.

---

## Step 4 — One-Shot Detection and Stdin Handling

```ts
const isPiped = !process.stdin.isTTY;
const oneShotMessage = positional.length > 0 ? positional.join(" ") : null;

let pipedInput = "";
if (isPiped) {
  pipedInput = (await Bun.stdin.text()).trim();
}

const oneShotInput = [oneShotMessage, pipedInput].filter(Boolean).join("\n").trim();
const isOneShot = oneShotInput.length > 0;
```

**Issue — positional args with no pipe are treated as one-shot but do not set `isPiped`.** `2b "hello"` enters one-shot mode (`isOneShot = true`, `isPiped = false`). The agent starts, `agent.addDirect` is called, and the `speak` listener calls `process.exit(0)`. But `CLIInputSource` also calls `process.stdin.resume()` inside `agent.start()`, and listens on `data`. In a TTY context stdin stays open after one message, meaning the agent and `CLIInputSource` are both live, but `process.exit(0)` fires before the user can type anything else. This works in practice but only by racing the event loop — `addDirect` is called synchronously after `agent.start()`, so the tick fires before any TTY input arrives. If `agent.start()` ever became async-heavier, the ordering guarantee would be lost.

**Issue — empty piped stdin causes a hard exit (line 84–87) but the error message mentions "No input provided" without context.** If the user pipes an empty file (`cat /dev/null | 2b`), they see `No input provided.` and a non-zero exit. This is correct behavior but gives no hint that stdin was empty.

**Issue — `oneShotInput` is constructed by joining positional args with spaces then piped input with a newline.** The separator between piped and positional content (`\n`) is different from the separator within positionals (` `). For `2b "hello" < file.txt`, the result is `hello\n<file contents>`. This is reasonable but undocumented, and the distinction is invisible to the user.

---

## Step 5 — Agent Construction and Plugin Wiring

`createAgent()` is the only call to construct the agent. It returns `{ agent, input }` but `index.ts` destructures only `{ agent }` (line 90), discarding `input`. The `CLIInputSource` instance is permanently unreachable from `index.ts` after this point.

**Issue — `input` (the `CLIInputSource`) is discarded.** There is no way for `index.ts` to call `input.stop()` on Ctrl+C or any other signal, because the reference is dropped. `CLIInputSource.stop()` pauses stdin, which is a clean shutdown action that is never taken. In practice Bun exits cleanly anyway, but the `stop()` method on `InputSource` is effectively dead code for this entry point.

**Issue — no `SIGINT` / `SIGTERM` handler.** Ctrl+C terminates the process abruptly. If the agent is mid-tool-call (e.g. a long `media_agent` download), there is no cleanup. Any partially written files or sub-process handles are left for the OS to clean up. This is an accepted trade-off for a local CLI tool but worth noting.

---

## Step 6 — Token Callback and Display Logic

The callback registered at line 105 handles both reasoning and response tokens:

```ts
agent.setTokenCallback((token, isReasoning) => {
  if (isReasoning) { ... }
  else {
    if (reasoningActive) { ... reasoningActive = false; }
    ...
  }
});
```

**Issue — `reasoningActive` and `responseActive` are module-level mutable state.** In interactive mode, `speak` resets both flags (lines 138–139). In one-shot mode, the `speak` handler does not reset them — it calls `process.exit(0)` immediately. This is safe for one-shot (there is only one turn) but means the two flags are never truly encapsulated; future changes that introduce multi-turn one-shot or retries would need to remember to reset them.

**Issue — `responseActive` is never reset to `false` within the callback itself.** The `[response]` header is printed once per turn via the `!responseActive` guard. `responseActive` is reset to `false` in the `speak` event handler. If `speak` fires before `setTokenCallback` finishes processing all tokens (unlikely but possible in an async stream), the header would be re-printed on the next token.

**Issue — in one-shot quiet mode, no trailing newline is guaranteed if the model produces zero response tokens.** The `speak` handler writes `quiet ? "\n" : RESET+"\n"`. If `quiet` is true and the model returns an empty string, stdout ends without a newline — breaking shell pipelines that consume `2b`'s output.

**Issue — `RESET` is written unconditionally in non-quiet one-shot exit (line 132).** If the last token was a reasoning token and `noReasoning` is false, `reasoningActive` would be `true` and a `RESET` was already written by the callback. The extra `RESET` is harmless (idempotent) but slightly redundant.

---

## Step 7 — One-Shot vs. Interactive Mode Branching

The two branches diverge at line 130:

```ts
if (isOneShot) {
  agent.once("speak", () => { ... process.exit(0); });
} else {
  agent.on("speak", () => { ... });
  // print banner and prompt
}

await agent.start();

if (isOneShot) {
  agent.addDirect(oneShotInput);
}
```

**Issue — event listener is registered before `agent.start()` in both branches, but `addDirect` is called after `agent.start()`.** This ordering is intentional (the comment at line 75 explains why stdin must be consumed before the agent starts), but the two-step split (`start()` then `addDirect`) is non-obvious. A reader unfamiliar with the codebase may wonder why the message is not passed into `createAgent` or `start`.

**Issue — in interactive mode, `agent.on("speak", ...)` is registered before `agent.start()`.** `BaseAgent.start()` calls plugin `onInit` hooks and then `scheduleTick()`. If a plugin's `onInit` somehow emitted `speak` synchronously (unlikely, but not structurally prevented), the listener would fire before the banner is printed.

---

## Step 8 — Error Handling and Visibility

`index.ts` registers no `error` event listener on the agent. `BaseAgent` emits `error` events when a tick throws and after notifying plugins. Without a listener, Node/Bun's `EventEmitter` default behavior is to **throw the error as an uncaught exception**, which will crash the process with a stack trace — visible but not user-friendly.

**Issue — no `error` event listener.** Unhandled `error` events from the agent will crash the process with a raw stack trace. A minimal handler that prints a readable message and optionally continues the interactive loop would improve UX.

**Issue — `memory-cmd.ts` calls `process.exit(1)` for unknown subcommands** (line 143 of `memory-cmd.ts`) but `index.ts` does not wrap `runMemoryCommand` in a try-catch. Any thrown exception (e.g. SQLite open failure mid-clear) will produce an unformatted stack trace.

---

## Step 9 — Integration Context

`index.ts` is the only integration point for `createAgent()`. The agent returned is a `CortexAgent`, which is a thin delegation wrapper over `BaseAgent`. The `CortexAgent` type exposes `on`/`once`/`off` via forwarding methods that preserve the `AgentEventMap` generic, so `index.ts` receives type-safe event subscriptions.

The `tool_call` event used at line 95 is emitted by `BaseAgent.act()` only when a plugin tool uses the `implementation` fallback wiring — not for inline `ToolDefinition.implementation` functions. `MinimalToolsPlugin` tools have inline implementations that call `this.emit("tool_call", ...)` manually. Sub-agent tool calls are forwarded via `SubAgentPlugin`'s `setToolCallHandler`. The result is that `--tools` does surface sub-agent calls, but only because `SubAgentPlugin` explicitly re-emits them.

---

## Summary Table

| Area | Severity | Issue |
|---|---|---|
| Subcommand routing | Medium | Flags before `memory` subcommand (e.g. `2b --quiet memory list`) silently fall through to interactive mode |
| Flag parsing | Medium | `--model` with no value is silently ignored; agent starts with the default model and no error |
| Flag parsing | Low | Unknown/unrecognised flags (e.g. `--verbose`) are silently dropped |
| One-shot mode | Medium | `CLIInputSource` reference is discarded; `stop()` is never called on shutdown |
| One-shot mode | Low | Ordering guarantee between `agent.start()` and `agent.addDirect()` is informal and fragile — depends on the event loop not processing TTY stdin between the two calls |
| Display state | Low | `reasoningActive` and `responseActive` are module-level mutable state; not reset in one-shot path |
| Display / quiet mode | Medium | Zero-token response in quiet one-shot mode produces no trailing newline, breaking pipe consumers |
| Error handling | High | No `error` event listener on the agent; unhandled errors crash with a raw stack trace |
| Error handling | Medium | `runMemoryCommand` is not wrapped in try-catch; SQLite errors produce unformatted stack traces |
| Shutdown | Low | No `SIGINT`/`SIGTERM` handler; mid-call tool operations (e.g. downloads) are not cleaned up |
| Code style | Low | `YELLOW` constant is declared after agent creation (line 92), separated from the other ANSI constants (line 4) |
| Subcommand routing | Low | No dispatch table; adding a second subcommand requires another top-level `if` block |
