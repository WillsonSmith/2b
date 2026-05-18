# LLM Providers

Language model backend. One interface, one concrete implementation.

## Files

| File | Purpose |
|------|---------|
| `LLMProvider.ts` | Interface contract for all LLM backends |
| `OllamaProvider.ts` | Ollama HTTP REST integration |
| `ModelCapabilityProvider.ts` | Wraps any `LLMProvider` to inject model-specific system prompt prefixes |
| `createProvider.ts` | Factory — constructs an `OllamaProvider` wrapped in `ModelCapabilityProvider` from env vars |

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

## OllamaProvider

Connects to a local Ollama server via HTTP REST (`http://127.0.0.1:11434` by default).

**Constructor:**
```typescript
new OllamaProvider(
  model?: string,       // default: "gemma3:4b"
  endpoint?: string,    // default: "http://127.0.0.1:11434"
  options?: {
    embeddingModel?: string;  // default: "nomic-embed-text"
    numCtx?: number;          // context window tokens — omit to let Ollama scale automatically
  }
)
```

**Reasoning extraction:** Ollama surfaces reasoning in `message.thinking` and the response in `message.content` as separate fields — no tag parsing needed. Chunks where `message.thinking` is set are emitted with `isReasoning: true`; chunks where `message.content` is set are emitted with `isReasoning: false`.

**`numCtx` — optional:** Ollama automatically scales context length based on available system resources. Set `numCtx` only if you need to cap or guarantee a specific size.

**Native tool-call loop:** `actWithTools()` runs up to 100 rounds. Each round streams the full message history with tools, collecting chunks silently. If the accumulated response has `tool_calls`, executes them and appends `{ role: "tool", content }` messages before the next round. The final round with no `tool_calls` emits the collected thinking and content to `onToken` and returns directly — the model is not re-invoked.

**Error propagation:** `chat()` throws on connection or API errors. Callers are responsible for handling the thrown error — `BaseAgent.tick()` catches it and emits the `"error"` event.

## Gotchas

- `getEmbedding()` uses a separate embedding model, not the chat model. Default is `nomic-embed-text` (must be pulled separately with `ollama pull nomic-embed-text`).
## Adding a New LLM Provider

Implement `LLMProvider` from `LLMProvider.ts` and pass an instance to `BaseAgent` or `HeadlessAgent`. No changes needed elsewhere.
