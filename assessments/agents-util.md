# Agents Util Assessment

## Module Overview

`src/agents/util.ts` is a single-function utility module that strips `<think>...</think>` XML-style tags — and their enclosed content — from a string. This is used to clean up model responses from reasoning-capable LLMs (such as DeepSeek-R1 or QwQ) that emit their chain-of-thought in `<think>` blocks before the final answer. The function prevents internal reasoning from being surfaced to the user or injected back into memory/context.

## Interface / Exports

### `removeThinkTags(inputString: string, flexibleMode?: boolean): string`

Removes `<think>...</think>` blocks from `inputString` and returns the cleaned string with leading/trailing whitespace trimmed.

**Parameters:**
- `inputString: string` — the raw model output to process.
- `flexibleMode: boolean` — optional, defaults to `false`.

**Return value:** The input string with all matched think-tag regions removed, then `.trim()`-ed.

**Modes:**

| Mode | Regex | Behavior |
|---|---|---|
| `false` (strict) | `/<think>[\s\S]*?<\/think>/g` | Requires both a literal `<think>` opening and `</think>` closing tag. Only complete pairs are removed. |
| `true` (flexible) | `/(?:^|<think>)[\s\S]*?<\/think>/g` | Also matches content from the very start of the string up to a `</think>` tag, handling cases where the opening `<think>` is absent (e.g., the string was truncated or streamed from a mid-thought position). |

Both modes use the `g` flag (global) to remove all occurrences, and `[\s\S]*?` (non-greedy, dot-all) to match content spanning multiple lines.

## Configuration

No environment variables, no dependencies, no imports. This is a pure function.

## Data Flow

1. A caller (agent processing pipeline, plugin, or response handler) receives raw model output.
2. `removeThinkTags(rawOutput)` is called, optionally with `flexibleMode = true`.
3. The regex replaces all matched regions with `""`.
4. `.trim()` removes any leading/trailing whitespace left by the removal.
5. The cleaned string is returned for display, memory storage, or further processing.

## Code Paths

### Strict mode — complete think block present
Input: `"<think>\nLet me reason...\n</think>\nHere is my answer."`
→ regex matches `<think>\nLet me reason...\n</think>` → replaced with `""` → `.trim()` → `"Here is my answer."`.

### Strict mode — no think block present
Input: `"Here is my answer."` → no regex match → `.trim()` → `"Here is my answer."`.

### Strict mode — unclosed think tag
Input: `"<think>reasoning without closing tag"` → no match (strict requires `</think>`) → string returned as-is after `.trim()`.

### Flexible mode — truncated string starting mid-thought
Input: `"reasoning continues...\n</think>\nFinal answer."` → `(?:^|<think>)` matches from `^` (start of string) → matches `"reasoning continues...\n</think>"` → removed → `.trim()` → `"Final answer."`.

### Flexible mode — normal complete block
Input: `"<think>reason</think>Answer"` → `(?:^|<think>)` matches `<think>` → removes the block → `.trim()` → `"Answer"`.

### Multiple think blocks
Input: `"<think>a</think>middle<think>b</think>end"` → global flag causes both matches → both removed → `.trim()` → `"middleend"`. Note: no separator is added between the remaining segments.

## Helper Functions / Internals

None. The entire module is a single exported function of 14 lines.

## Error Handling

No error handling. `String.prototype.replace` with a regex never throws under normal conditions. The function is safe to call with any string input, including empty strings (`""` → `""`) or strings with no think tags.

## Integration Context

As of the current codebase scan, **no other module imports `removeThinkTags` from `src/agents/util.ts`**. The function is exported but currently unused within the codebase. This may indicate:

1. It was recently added in anticipation of reasoning-model support but has not yet been wired into the response pipeline.
2. It was used by a module that was subsequently refactored or removed.
3. It is called from an entry point or test file not yet present.

The natural integration points would be:
- **`src/providers/llm/LMStudioProvider.ts`**: After receiving model output, before returning it to the agent.
- **`src/core/BaseAgent.ts`** or **`src/core/HeadlessAgent.ts`**: When processing LLM responses before emitting them or storing in memory.
- **`src/plugins/MemoryPlugin.ts`** or **`src/plugins/CortexMemoryPlugin.ts`**: Before storing a model response in persistent memory.

## Observations / Notes

- **Flexible mode addresses a real streaming edge case**: When model output is streamed and the accumulated buffer starts in the middle of a `<think>` block (because the opening tag arrived in a prior chunk that was already processed), strict mode would fail to remove it. Flexible mode handles this by also matching from the start of the string to the first `</think>`.
- **Non-greedy matching is important**: `[\s\S]*?` (non-greedy) ensures that in a string with multiple think blocks, each block is matched independently rather than consuming everything from the first `<think>` to the last `</think>`. Without the `?`, `"<think>a</think>text<think>b</think>"` would be consumed in a single match.
- **`.trim()` may be too aggressive**: If the cleaned string legitimately begins or ends with whitespace (e.g., a formatted code block that starts with a newline), `.trim()` will remove it. A more targeted trim (e.g., only stripping the whitespace immediately adjacent to a removed block) might be more precise.
- **No handling of nested `<think>` tags**: The regex does not account for nested `<think>` blocks. `"<think>outer<think>inner</think>outer</think>"` would match only up to the first `</think>`, leaving `"outer</think>"` in the output. In practice, reasoning models do not nest think tags, so this is not a current concern.
- **The module name is generic**: `util.ts` inside `src/agents/` suggests it may accumulate additional agent-level utility functions over time. Currently it contains only this one function.
- **No tests**: There are no corresponding test files for this module. Given the regex complexity (especially flexible mode's start-of-string anchor), unit tests would be a valuable addition.
