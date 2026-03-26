# TimePlugin Assessment

## Module Overview

TimePlugin is a minimal utility plugin that gives the agent awareness of the current local date and time. It serves two purposes: it injects the current time into the agent's context at every tick via `getContext()`, and it exposes a `get_current_time` tool the LLM can call on demand. This means the agent always has passive time awareness without needing to invoke a tool, while still being able to refresh or confirm the time explicitly.

It is the simplest plugin in the codebase — no network calls, no API keys, no configuration.

## Interface / Exports

```typescript
export class TimePlugin implements AgentPlugin
```

**Constructor**

No constructor is defined; the default no-arg constructor is used.

**Implemented AgentPlugin hooks**

| Hook | Returns |
|---|---|
| `onInit(agent)` | Logs `"Plugin initialized."` at info level; no side effects |
| `getContext()` | `"The current time is <locale time string>"` — injected into system prompt context on every tick |
| `getTools()` | One tool definition: `get_current_time` |
| `executeTool(name, args)` | Returns `new Date().toString()` for `get_current_time`; throws for unknown names |

**Tool: `get_current_time`**

- **Parameters**: None (`properties: {}`).
- **Returns**: `string` — the result of `new Date().toString()`, which is the full local date/time string including timezone offset (e.g., `"Tue Mar 25 2026 14:30:00 GMT-0400 (Eastern Daylight Time)"`).

## Configuration

None. No environment variables, no constructor options, no external dependencies. The plugin is entirely self-contained.

## Data Flow

### Passive path (context injection)

```
BaseAgent.act()
  → plugin.getContext(allInputs)
    → returns "The current time is 2:30:45 PM"
  → appended to pluginContext string
  → included in system prompt under "Plugin Context:"
```

This runs on every agent tick, so the LLM always sees the current time without calling any tool.

### Active path (tool call)

```
LLM calls get_current_time {}
  → executeTool("get_current_time", {})
    → return new Date().toString()
```

The two paths produce slightly different formats: `getContext()` uses `toLocaleTimeString()` (time only, locale-formatted), while `executeTool` uses `toString()` (full date + time + timezone). They will generally agree on the time value but differ in detail and format.

## Code Paths

### `onInit`

Called by `BaseAgent.start()` once all plugins are registered. Logs an info message. No functional behaviour; purely a lifecycle hook used for observability.

### `getContext`

Called on every agent tick by `BaseAgent.act()`. Creates a `new Date()` at call time and returns it formatted with `toLocaleTimeString()`. The `currentEvents` parameter from the `AgentPlugin` interface signature is accepted (as `_agent` in `onInit` convention) but not used.

### `executeTool` — `get_current_time`

Creates a fresh `new Date()` and returns it as a full string via `.toString()`. This is the same wall-clock time but with more detail than `getContext`.

### `executeTool` — unknown tool

Throws `new Error("Tool ${name} not found in TimePlugin")`. This is the only plugin in the codebase that throws on an unknown tool name rather than returning `undefined`. `BaseAgent.act()` does not catch per-tool errors at this granularity; the throw would propagate up to the outer try-catch in `tick()`, emit an `"error"` event, and surface as a plugin error log.

## Helper Functions / Internals

None. The plugin has no private methods or module-level helpers.

## Error Handling

| Scenario | Handling |
|---|---|
| Unknown tool name | Throws `Error` — unique behaviour in this codebase |
| `getContext` failure | `new Date()` cannot throw; no error path exists |
| `onInit` failure | Logger call cannot throw; no error path exists |

The throwing behaviour on unknown tool names differs from every other plugin in the codebase, which return `undefined` implicitly. If `BaseAgent` gains a second plugin that calls the same tool name, or if there is a naming collision, TimePlugin will throw rather than no-op.

## Integration Context

TimePlugin is not wired into any of the named sub-agents (`createSystemAgent`, `createInfoAgent`, `createWebAgent`, `createMediaAgent`). Based on the grep results, TimePlugin is defined and exported but has no current import site in any agent factory or configuration file visible in the codebase. It appears to be available for use but not yet registered anywhere.

When registered (via `BaseAgent.registerPlugin(new TimePlugin())`), `BaseAgent.act()` would:
1. Call `plugin.onInit(this)` during `start()`.
2. Call `plugin.getContext()` on every tick and prepend the time string to the system prompt context block.
3. Wire `get_current_time` as an available tool.

## Observations / Notes

- **Dual time injection**: Both `getContext()` and the tool return the current time, but in different formats (`toLocaleTimeString()` vs `toString()`). If both are active simultaneously, the LLM sees the time in the context AND can call the tool for a richer version. These will always be consistent in value but different in shape.
- **`getContext` parameter is ignored**: The `AgentPlugin.getContext` interface accepts `currentEvents?: string[]`, but TimePlugin's implementation ignores it. This is intentional — time is unconditional.
- **Throws on unknown tool name**: All other plugins in this codebase return `undefined` for unknown tool names. TimePlugin throws. This is a minor inconsistency that could cause a surprising error if `BaseAgent` dispatches a mismatched tool name to this plugin.
- **No `getSystemPromptFragment`**: Unlike most other plugins, TimePlugin does not implement `getSystemPromptFragment`. Time awareness is injected only via `getContext`, which appears in the "Plugin Context:" section of the system prompt rather than as a top-level instruction fragment. The practical effect is the same, but the placement differs.
- **Locale dependency**: `toLocaleTimeString()` uses the system locale and timezone. On a server with a UTC timezone setting, the context string will display UTC time. `new Date().toString()` includes the timezone offset explicitly, making the tool's output more portable.
- **No date in `getContext`**: The `getContext` return value is only the time (`toLocaleTimeString()`), not the date. The tool returns the full date+time. If an agent needs to know the current date passively, it would need to also call the tool or the `getContext` implementation would need updating.
