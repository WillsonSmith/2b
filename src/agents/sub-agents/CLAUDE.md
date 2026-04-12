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

## Available Sub-agent Factories

| Factory | Agent Name | Plugins | Used by |
|---------|-----------|---------|---------|
| `createMediaAgent` | `MediaAgent` | `YtDlpPlugin`, `FFmpegPlugin`, `ImageVisionPlugin` | `DynamicAgentPlugin` preset (`media`) |
| `createInfoAgent` | `InfoAgent` | `TMDBPlugin`, `WeatherPlugin`, `WikipediaPlugin` | `DynamicAgentPlugin` preset (`info`) |
| `createFileSystemAgent` | `FileSystemAgent` | `FileSystemPlugin`, `ShellPlugin` | Available but not registered — filesystem is now a direct plugin on the orchestrator |
| `createCodeReaderAgent` | `CodeReaderAgent` | `SourceReaderPlugin` | Static `SubAgentPlugin` (`explore_codebase`) — owns its own code-specific LLM |
| `createCodebaseExplainerAgent` | `CodebaseExplainerAgent` | `SourceReaderPlugin` | Static `SubAgentPlugin` (`explain_codebase`) — educational explanations with code samples |
| `createWebAgent` | `WebAgent` | `WebSearchPlugin`, `WebReaderPlugin`, `WikipediaPlugin`, `RSSPlugin` | Available, not currently registered |
| `createSystemAgent` | `SystemAgent` | `ShellPlugin`, `FileSystemPlugin`, `DownloadPlugin`, `ClipboardPlugin`, `CodeSandboxPlugin` | Available, not currently registered |

> **Note:** Most sub-agent functionality is now handled by `DynamicAgentPlugin` using the capability registry rather than static factories. The factories above are still usable but new domain agents should be added as capability entries in `DynamicAgentPlugin`'s `CAPABILITY_REGISTRY` rather than new factory files.

`createCodeReaderAgent` creates its own `LMStudioProvider` internally (defaults to `qwen2.5-coder-7b-instruct-mlx`, overridable via `CODE_READER_MODEL` env var or `model` option). It does not take the orchestrator's `llm` — it owns its own model connection.

## Options Pattern

Each factory accepts an options object. Common options:

| Option | Type | Purpose |
|---|---|---|
| `permissionManager` | `PermissionManager` | Forwarded to `HeadlessAgent`; tools with `permission !== "none"` require approval |

`createMediaAgent` additionally accepts `visionModel` and `visionBaseUrl` to configure `ImageVisionPlugin`.

## How Presets Work (DynamicAgentPlugin)

Rather than registering static `SubAgentPlugin` instances, preset agents are defined in `DynamicAgentPlugin`'s `presets` constructor option and created at init time as headless agents:

```typescript
new DynamicAgentPlugin(llm, {
  permissionManager,
  model,
  presets: {
    media: {
      system_prompt: "...",
      capabilities: ["media", "image_vision", "download"],
    },
  },
})
```

The orchestrator can call them immediately via `call_agent("media", task)` without a creation step.

## Gotchas

- `HeadlessAgent` does not call `onInit` on plugins — plugin constructors must not do I/O.
- Sub-agents have no shared state between calls. Each `ask()` is independent.
- Pass the orchestrator's `permissionManager` through to each factory so sensitive tools (e.g. `ShellPlugin`) prompt the user rather than auto-denying.
- For agents that need to remember context across calls, use `CortexSubAgent` (via `DynamicAgentPlugin` with `agent_type: "cortex"`) instead of a `HeadlessAgent` factory.
