# LLM Providers

Language model backend. One interface, two concrete implementations, one helper.

## Files

| File | Purpose |
|------|---------|
| `LLMProvider.ts` | Interface contract for all LLM backends |
| `LMStudioProvider.ts` | LMStudio SDK integration via WebSocket |
| `OllamaProvider.ts` | Ollama HTTP REST integration |
| `StructuredToolCaller.ts` | Manual JSON-schema tool-call loop for models without native tool support (LMStudio only) |

## LLMProvider Interface

```typescript
interface LLMProvider {
  chat(
    messages: Message[],
    systemPrompt?: string,
    schema?: unknown,
    tools?: ToolDefinition[],
    onToken?: (token: string, isReasoning: boolean) => void,
  ): Promise<ChatResponse>;

  getEmbedding(text: string): Promise<number[]>;
}
```

`ChatResponse` has three fields:
- `response` — full raw text including any reasoning prefix
- `nonReasoningContent` — clean prose only (reasoning stripped)
- `reasoningText` — extracted chain-of-thought text

Callers in `BaseAgent` and `HeadlessAgent` use `nonReasoningContent` for the agent response and `reasoningText` to emit `thought` events.

## LMStudioProvider

Connects to a local LMStudio server via WebSocket (`ws://127.0.0.1:1234` by default).

**Constructor:**
```typescript
new LMStudioProvider(
  model?: string,       // default: "google/gemma-3-4b"
  endpoint?: string,    // default: "ws://127.0.0.1:1234"
  options?: {
    toolCallingStrategy?: "native" | "structured_output";  // default: "native"
    embeddingModel?: string;  // default: "nomic-embed-text-v1.5"
  }
)
```

**Tool calling strategies:**

| Strategy | How it works | When to use |
|---|---|---|
| `"native"` | Uses LMStudio SDK `model.act()` with `rawFunctionTool` | Models with built-in tool protocol (most GGUF instruct models) |
| `"structured_output"` | Delegates to `StructuredToolCaller` — constrained JSON decoding | Any model that doesn't support native tools |

The strategy is set per-provider instance and applies to all `chat()` calls with tools. `AgentConfig.toolCallingStrategy` is passed through when constructing `LMStudioProvider` via agent factories.

**Reasoning extraction:** `processFragment()` routes fragments based on `reasoningType`:
- `"reasoning"` → appended to `reasoningText`, streamed with `isReasoning: true`
- `"none"` or unknown → appended to `responseContent`, leaked `</think>` tags stripped

**Post-tool-call streaming fallback:** After `act()` finishes, if tool calls occurred but no post-tool response was streamed via `onPredictionFragment`, the SDK-captured `nonReasoningContent` is emitted directly. This handles models that return content without triggering the fragment callback.

## StructuredToolCaller

Used automatically when `toolCallingStrategy === "structured_output"`. Not called directly.

**How it works:**
1. Appends a tool-calling instruction block to the system prompt (via `buildToolSystemPromptAddition`)
2. Loops up to 10 iterations calling `model.respond()` with a JSON schema envelope
3. If the model responds `{"type": "tool_call", ...}` — calls the tool and feeds the result back as a user message
4. If the model responds `{"type": "message", ...}` — returns the content as the final answer
5. If 10 iterations are exhausted without a final message, throws `ToolCallLimitError`

**`ToolCallLimitError`** is a named error subclass — catch it specifically if you need to distinguish the limit case.

## OllamaProvider

Connects to a local Ollama server via HTTP REST (`http://127.0.0.1:11434` by default).

**Constructor:**
```typescript
new OllamaProvider(
  model?: string,       // default: "gemma3:4b"
  endpoint?: string,    // default: "http://127.0.0.1:11434"
  options?: {
    toolCallingStrategy?: "native" | "structured_output";  // default: "native"
    embeddingModel?: string;  // default: "nomic-embed-text"
    numCtx?: number;          // context window tokens — omit to let Ollama scale automatically
  }
)
```

**Tool calling strategies:**

| Strategy | How it works | When to use |
|---|---|---|
| `"native"` | Sends tools in OpenAI format; drives a manual agentic loop checking `tool_calls` on each response | Models with Ollama tool support (llama3, mistral, etc.) |
| `"structured_output"` | Uses `buildToolSystemPromptAddition` + Ollama `format` (JSON schema) to constrain output | Any model that doesn't support native tools |

**Reasoning extraction:** Ollama has no SDK-level reasoning markers. `parseStreamChunk()` manually detects `<think>...</think>` tags across streaming chunk boundaries:
- Content inside `<think>...</think>` → `reasoningText`, streamed with `isReasoning: true`
- All other content → `nonReasoningContent`, streamed with `isReasoning: false`

**`numCtx` — optional:** Ollama automatically scales context length based on available system resources. Set `numCtx` only if you need to cap or guarantee a specific size.

**Native tool-call loop:** `actWithTools()` runs up to 10 rounds. Each round sends the full message history with tools; if the response has `tool_calls`, executes them and appends `{ role: "tool", content }` messages before the next round. The final round with no `tool_calls` is returned as the response.

## Gotchas

- `getEmbedding()` uses a separate embedding model, not the chat model. LMStudio default is `nomic-embed-text-v1.5` (must be loaded in LMStudio). Ollama default is `nomic-embed-text` (must be pulled separately with `ollama pull nomic-embed-text`).
- In LMStudio `"native"` mode, tools without an `implementation` on `ToolDefinition` will throw at the LMStudio level. `BaseAgent` and `HeadlessAgent` wrap every tool with an implementation before passing to `chat()`.
- `"structured_output"` does not stream tokens (`onToken` is not called for LMStudio; same for Ollama). The response is only available after all tool rounds complete.
- Ollama `"structured_output"` uses Ollama's `format` parameter (JSON schema), not the LMStudio SDK's constrained decoding. `StructuredToolCaller` is LMStudio-only; `OllamaProvider` has its own inline implementation.
