# Sub-agents

Domain-specific `HeadlessAgent` factories. Each creates a focused agent with a curated plugin set.

## Pattern

Each file exports a single `create<Name>Agent(llm, options?)` function that returns a `HeadlessAgent`:

```typescript
export function createCodebaseExplainerAgent(llm: LLMProvider, options: Options = {}): HeadlessAgent {
  return new HeadlessAgent(llm, [new SourceReaderPlugin(options)], "Focused system prompt...", {
    agentName: "CodebaseExplainerAgent",
  });
}
```

The factory handles all plugin construction. Callers just pass `llm` and optional overrides.

## Available Sub-agent Factories

| Factory | Agent Name | Plugins | Used by |
|---------|-----------|---------|---------|
| `createCodebaseExplainerAgent` | `CodebaseExplainerAgent` | `SourceReaderPlugin` | Static `SubAgentPlugin` (`explore_codebase`) in `2b.ts` |

> **Note:** Domain sub-agent functionality is handled by `DynamicAgentPlugin` using the capability registry. Add new domain agents as capability entries in `DynamicAgentPlugin`'s `CAPABILITY_REGISTRY` rather than new factory files here.

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
