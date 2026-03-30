# Sub-agents

Domain-specific `HeadlessAgent` factories. Each creates a focused agent with a curated plugin set.

## Pattern

Each file exports a single `create<Name>Agent(llm, options?)` function that returns a `HeadlessAgent`:

```typescript
export function createMediaAgent(llm: LLMProvider, options: MediaAgentOptions = {}): HeadlessAgent {
  return new HeadlessAgent(llm, [plugin1, plugin2, plugin3], "Focused system prompt...", {
    agentName: "MediaAgent",
    permissionManager: options.permissionManager,
  });
}
```

The factory handles all plugin construction. Callers just pass `llm` and optional overrides.

## Available Sub-agents

| Factory | Agent Name | Plugins |
|---------|-----------|---------|
| `createMediaAgent` | `MediaAgent` | `YtDlpPlugin`, `FFmpegPlugin`, `ImageVisionPlugin` |
| `createWebAgent` | `WebAgent` | `WebSearchPlugin`, `WebReaderPlugin`, `WikipediaPlugin`, `RSSPlugin` |
| `createFileSystemAgent` | `FileSystemAgent` | `FileSystemPlugin` |
| `createCodeReaderAgent` | `CodeReaderAgent` | `SourceReaderPlugin` |
| `createSystemAgent` | `SystemAgent` | `ShellPlugin`, `FileSystemPlugin`, `DownloadPlugin`, `ClipboardPlugin`, `CodeSandboxPlugin` |
| `createInfoAgent` | `InfoAgent` | `TMDBPlugin`, `WeatherPlugin`, `NotesPlugin` |

`createCodeReaderAgent` creates its own `LMStudioProvider` internally (defaults to `qwen2.5-coder-7b-instruct-mlx`, overridable via `CODE_READER_MODEL` env var or `model` option). It does not take the orchestrator's `llm` — it owns its own model connection.

## Options Pattern

Each factory accepts an options object. Common options:

| Option | Type | Purpose |
|---|---|---|
| `permissionManager` | `PermissionManager` | Forwarded to `HeadlessAgent`; tools with `permission !== "none"` require approval |

`createMediaAgent` additionally accepts `visionModel` and `visionBaseUrl` to configure `ImageVisionPlugin`.

## How Sub-agents Are Used

In `AgentFactory.ts`, each sub-agent is wrapped in a `SubAgentPlugin` and registered on the orchestrator `CortexAgent`. The sub-agent's tool calls are forwarded to the parent's `tool_call` event via `setToolCallHandler`.

## Adding a New Sub-agent

1. Create `create<Name>Agent.ts` here, following the factory pattern above
2. Choose a focused system prompt — sub-agents work best with narrow responsibilities
3. Register in `src/agents/AgentFactory.ts`:
   ```typescript
   new SubAgentPlugin({
     toolName: "name_agent",
     description: "What this agent does",
     agent: createNameAgent(llm, { permissionManager }),
     inactivityTimeoutMs: 30_000,  // optional
   })
   ```

## Gotchas

- `HeadlessAgent` does not call `onInit` on plugins — plugin constructors must not do I/O.
- Sub-agents have no shared state between calls. Each `ask()` is independent.
- Pass the orchestrator's `permissionManager` through to each factory so sensitive tools (e.g. `ShellPlugin`) prompt the user rather than auto-denying.
