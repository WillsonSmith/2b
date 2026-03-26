# CodeSandboxPlugin Assessment

## Module Overview

`CodeSandboxPlugin` enables the agent to execute arbitrary Python 3.11 code in a fully isolated container environment. Rather than requiring the calling LLM to write Python itself, the plugin separates code generation from execution: the orchestrator LLM describes the task in plain language via the `execute_code` tool, and a dedicated local coding model (via LM Studio) generates the Python. That code is then run inside a sandboxed container (Docker or Apple Container on macOS) with strict resource limits, no network access, and no host filesystem access. This two-model pipeline keeps the orchestrator focused on task understanding while delegating syntactically correct Python generation to a specialized model.

## Interface / Exports

### `class CodeSandboxPlugin implements AgentPlugin`

| Member | Signature | Purpose |
|---|---|---|
| `name` | `string = "CodeSandbox"` | Plugin identifier |
| `onInit(_agent)` | `async (agent: BaseAgent) => Promise<void>` | Eagerly triggers initialization (image pre-pull) without blocking agent startup |
| `getSystemPromptFragment()` | `() => string` | Injects instructions for the orchestrator LLM on how to use the sandbox |
| `getTools()` | `() => ToolDefinition[]` | Returns the single `execute_code` tool definition |
| `executeTool(name, args)` | `async (name, args) => Promise<any>` | Validates input, generates code, runs container, returns result |

### Constants (module-level)

| Constant | Value | Purpose |
|---|---|---|
| `MAX_TIMEOUT_MS` | `60_000` | Hard cap on execution timeout |
| `DEFAULT_TIMEOUT_MS` | `15_000` | Default execution timeout if not specified by caller |
| `MAX_OUTPUT_BYTES` | `65536` (64 KB) | Maximum stdout/stderr returned to caller |
| `MAX_INPUT_BYTES` | `262144` (256 KB) | Maximum allowed size for `input_data` and generated code |
| `CONTAINER_IMAGE` | `"python:3.11-slim"` | Docker/container image used for execution |
| `DEFAULT_CODE_MODEL` | `"qwen2.5-coder-7b-instruct-mlx"` | LM Studio model for code generation |

### Type alias

```typescript
type ContainerRuntime = "docker" | "apple-container";
```

## Configuration

| Config | Source | Default |
|---|---|---|
| `CODE_MODEL` env var | `process.env.CODE_MODEL` | `"qwen2.5-coder-7b-instruct-mlx"` |
| Container runtime | Auto-detected via `detectRuntime()` | `"docker"` (non-macOS) or whichever is available on macOS |
| LM Studio endpoint | Default `LMStudioClient()` constructor | Local LM Studio instance on default port |

**External dependencies:**
- LM Studio running locally with the code model loaded
- `docker` CLI in PATH, or `container` CLI (Apple Container) in PATH on macOS
- Internet access to pull `python:3.11-slim` on first run (unless already cached)

## Data Flow

```
executeTool("execute_code", { task, input_data?, timeout_ms? })
  → Input validation (task length, input_data JSON validity, size limits)
  → generateCode(codeGenPrompt)
      → LMStudioClient.llm.model(codeModel)
      → modelClient.respond(chat) [streaming]
      → stripCodeFences(raw)
  → buildRunArgs(input_data)  [Docker or Apple Container hardening flags]
  → Bun.spawn([runtime, "run", ..., "python", "-c", code])
  → Promise.race([proc.exited, timeout])
  → Read stdout + stderr via Response.text()
  → truncate() both streams to MAX_OUTPUT_BYTES
  → return { stdout, stderr, exitCode, success, timedOut, generatedCode }
```

`input_data` (when provided) is passed into the container as the `INPUT_DATA` environment variable, allowing the generated code to read structured data without embedding it in the source.

## Code Paths

### Initialization (`ensureInitialized` / `initialize`)
Initialization is lazy and idempotent — `initPromise` is set on the first call and reused for all subsequent calls. The `onInit` hook triggers this eagerly (fire-and-forget) so the image is pre-pulled by the time the first user request arrives.

Steps:
1. `detectRuntime()` — on macOS, checks if `container` binary exists in PATH. Returns `"apple-container"` or `"docker"`.
2. If `apple-container`, runs `container system start` to bring up the VM runtime.
3. Pulls `python:3.11-slim` using the appropriate CLI. Pull failure is non-fatal (logged as info, not error) — the image will be pulled on first container run.

### Tool execution (`executeTool`)
1. Ignores any tool name other than `"execute_code"` (returns `undefined`).
2. Validates `task`: must be non-empty string, must not exceed 4096 bytes.
3. Validates `input_data` if present: must not exceed `MAX_INPUT_BYTES`, must be valid JSON.
4. Clamps `timeout_ms` to range `(0, MAX_TIMEOUT_MS]`; defaults to `DEFAULT_TIMEOUT_MS` if invalid.
5. Builds code generation prompt, appends input-data reading hint if `input_data` is provided.
6. Calls `generateCode()` which streams from LM Studio and strips code fences.
7. Validates generated code size (must not exceed `MAX_INPUT_BYTES`).
8. Calls `buildRunArgs()` to assemble container CLI flags.
9. Spawns the container process. Races process exit against a `setTimeout` kill.
10. Reads stdout and stderr, truncates each to `MAX_OUTPUT_BYTES`.
11. Returns the result object.

### Docker hardening flags (`buildRunArgs` — docker path)
```
docker run --rm --network=none --memory=256m --cpus=0.5 --pids-limit=64
           --security-opt=no-new-privileges:true --cap-drop=ALL
           --user=65534 --read-only --tmpfs /tmp:size=32m,noexec,nosuid,nodev
```

### Apple Container hardening flags (`buildRunArgs` — apple-container path)
```
container run --rm --no-dns --memory 256M --cpus 0.5 --ulimit nproc=64:64
              --uid 65534 --read-only --tmpfs /tmp
```
Note: the Apple Container path does not set a tmpfs size or `noexec` mount options; the Docker path is more restrictive in this regard.

## Helper Functions / Internals

### `detectRuntime(): Promise<ContainerRuntime>` (module-level)
Spawns `which container`. Returns `"apple-container"` if the binary exists, `"docker"` otherwise. Always returns `"docker"` on non-macOS platforms.

### `stripCodeFences(text: string): string` (module-level)
Removes leading ` ```python ` or ` ``` ` fences and trailing ` ``` ` from LLM output. Applies `.trim()`. This handles the common case where the coding model wraps its output in markdown despite instructions not to.

### `generateCode(prompt: string): Promise<string>` (private)
Opens the code model via `LMStudioClient`, constructs a two-message chat (system + user), streams the response token by token, then calls `stripCodeFences()` on the accumulated result.

### `ensureInitialized(): Promise<void>` (private)
Idempotent singleton pattern: creates `initPromise` once and returns it on subsequent calls. Prevents concurrent initialization races.

### `truncate(text: string, maxBytes: number): string` (module-level)
Byte-aware truncation: if the text exceeds `maxBytes`, slices the Buffer and appends a `[output truncated at N bytes]` marker. Handles multi-byte UTF-8 correctly by operating on `Buffer` rather than string length.

### `buildRunArgs(input_data?: string | null): string[]` (private)
Assembles the CLI flags for the chosen container runtime. Appends `-e INPUT_DATA=<value>` if `input_data` is not null/undefined.

## Error Handling

| Scenario | Handling |
|---|---|
| Invalid task (empty or > 4096 bytes) | `throw new Error(...)` — propagated to LLM as tool error |
| Invalid input_data (non-JSON or too large) | `throw new Error(...)` — propagated to LLM |
| Generated code too large | `throw new Error(...)` — propagated to LLM |
| LM Studio unreachable | Unhandled — `generateCode` will throw, propagated to LLM |
| Container execution timeout | Process is SIGKILLed; result includes `timedOut: true`, `exitCode: null` |
| Container exits non-zero | Result includes `success: false`, `exitCode: <N>`, stderr captured |
| Pre-pull failure at init | Logged as info, silently ignored — container will pull on first run |
| `initialize()` runtime detection failure | No explicit handling; `Bun.spawn` errors propagate |

## Integration Context

**Registered in:** `src/agents/sub-agents/createSystemAgent.ts` alongside `ShellPlugin`, `FileIOPlugin`, and `ClipboardPlugin`.

```typescript
new HeadlessAgent(llm, [new ShellPlugin(), new FileIOPlugin(), new ClipboardPlugin(), new CodeSandboxPlugin()], ...)
```

**Depends on:**
- `@lmstudio/sdk` — `LMStudioClient`, `Chat`
- `src/core/Plugin.ts` — `AgentPlugin`, `ToolDefinition`
- `src/core/BaseAgent.ts` — for `onInit` signature
- `src/logger.ts` — info/debug/error logging
- System: `docker` or `container` CLI, internet access for image pulls

**Used by:** The orchestrator's `system_agent` sub-agent. The orchestrator passes task descriptions via the `execute_code` tool, which the `system_agent` then fulfills.

## Observations / Notes

1. **Two-model pipeline:** The architecture intentionally separates the orchestrator (reasoning about what to compute) from the code generator (producing syntactically valid Python). This reduces cognitive load on the orchestrator and allows using a smaller, faster model for code generation.

2. **`onInit` is fire-and-forget:** `this.ensureInitialized()` is called without `await` in `onInit`. This means the agent starts immediately, but initialization (including image pull) runs in the background. If a tool call arrives before initialization finishes, `executeTool` awaits `ensureInitialized()` and will block until ready — this is correct behavior.

3. **Apple Container tmpfs is less restrictive:** The Docker path mounts tmpfs with `size=32m,noexec,nosuid,nodev`, preventing execution of binaries written to `/tmp`. The Apple Container path uses `--tmpfs /tmp` with no such constraints. This is a minor security discrepancy.

4. **`input_data` is passed as a raw env var string:** The `INPUT_DATA` environment variable contains the JSON string directly. For well-formed JSON this is fine, but JSON containing shell metacharacters could theoretically cause issues depending on how the runtime handles env var injection.

5. **`stripCodeFences` is applied once:** If a model outputs nested fences or unusual formatting, the regex may not clean the output fully, resulting in a Python syntax error at runtime. The `stderr` in the result will reveal this.

6. **No retry logic:** If the code model produces invalid Python, the result will include `exitCode: 1` and a Python traceback in `stderr`. The caller (LLM) would need to call `execute_code` again with a more specific task description to retry.

7. **Streaming code generation with no progress signal:** Code generation is streamed internally to avoid large single-response payloads, but there is no way for the caller to observe progress during the generation phase. The tool call appears to hang from the caller's perspective during long code generation.

8. **`Buffer.byteLength(task) > 4096` limit:** The 4096-byte task size limit is reasonable for natural-language descriptions. This is separate from the 256 KB limit on `input_data` and generated code, which are sized for structured data and executable code respectively.
