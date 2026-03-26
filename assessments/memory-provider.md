# MemoryProvider Assessment

## Module Overview

`src/memory/MemoryProvider.ts` is a pure interface definition file. It defines the contract that any conversation memory backend must satisfy, along with the data shapes those backends operate on. It contains no implementation code — only TypeScript `interface` declarations. Its purpose is to decouple the agents and plugins that consume memory from any specific storage mechanism (in-memory, SQLite, vector DB, etc.).

## Interface / Exports

### `MemoryItem` (interface)
```ts
export interface MemoryItem {
  id?: number | string;
  role: "user" | "agent" | "assistant" | "system";
  content: string;
  interactionType: string;
  timestamp?: string;
}
```
Represents a single stored message or event. Fields:
- `id`: Optional unique identifier. Can be numeric or string (flexible for different backends).
- `role`: Who produced this message. Accepts `"user"`, `"agent"`, `"assistant"`, or `"system"`.
- `content`: The text body of the message.
- `interactionType`: A free-form string describing how the message was received, e.g. `'direct'`, `'overheard'`, `'vision'`, `'system'`. Not constrained to a fixed enum.
- `timestamp`: Optional ISO string timestamp. Marked optional to allow backends that don't track time.

### `MemoryQuery` (interface)
```ts
export interface MemoryQuery {
  limit?: number;
}
```
A query/filter object for retrieval operations. Currently contains only `limit`. The comment explicitly notes it is designed for extension: vector search, time-range filtering, etc.

### `MemoryProvider` (interface)
The primary contract. Any class implementing `MemoryProvider` must provide:

#### `addMessage(role, content, interactionType?): Promise<void> | void`
Stores a new message in the memory backend. `interactionType` is optional (defaults to whatever the implementation chooses). The return type is `Promise<void> | void`, allowing both synchronous (in-memory) and asynchronous (database) implementations.

#### `getRecentContext(limit?): Promise<string> | string`
Returns recent conversation history as a single formatted string, suitable for injection into a system prompt or context block. `limit` controls how many messages to include. Return type allows sync or async.

#### `getRecentMessages(limit?): Promise<{ role: string; content: string }[]> | { role: string; content: string }[]`
Returns recent messages as an array of `{ role, content }` objects — the format expected by chat-completion APIs. `limit` controls array length. Return type allows sync or async.

## Configuration

None. This is a pure TypeScript interface file with no runtime behavior, no environment variables, and no dependencies.

## Data Flow

This module defines shapes; it does not process data. The flow it describes:

1. A caller (agent, plugin) stores a message via `addMessage`.
2. The implementation records it internally (in-memory list, SQLite row, etc.).
3. A caller retrieves context via `getRecentContext` (string) or `getRecentMessages` (array).
4. The formatted context is injected into an LLM prompt or passed as a message history array.

## Code Paths

There are no executable code paths in this module — it is declaration-only. All logic lives in implementations.

## Helper Functions / Internals

None. The file is 33 lines of pure interface declarations.

## Error Handling

Not applicable. Implementations are responsible for their own error handling.

## Integration Context

As of the current codebase scan, **no other module directly imports from `src/memory/MemoryProvider.ts`**. The file exists as a specification but implementations found in the codebase (e.g., `CortexMemoryDatabase`) do not explicitly declare `implements MemoryProvider`. This suggests the interface is either:

1. Used as informal documentation / design intent rather than an enforced contract.
2. Intended for future implementations that will explicitly reference it.
3. Previously wired up and since decoupled during refactoring.

Related modules that deal with memory storage but do not reference this interface:
- `src/plugins/CortexMemoryDatabase.ts` — the active SQLite-backed memory store.
- `src/plugins/MemoryPlugin.ts` — likely wraps in-memory or database-backed storage.
- `src/plugins/CortexMemoryPlugin.ts` — plugin facade over `CortexMemoryDatabase`.

## Observations / Notes

- **Not currently enforced**: Because no implementation explicitly `implements MemoryProvider`, TypeScript structural typing means a class can satisfy the contract without declaring it. However, there is also no `import type { MemoryProvider }` anywhere in the codebase, meaning drift between the interface and implementations would not be caught at compile time.
- **Dual sync/async return types** (`Promise<T> | T`): This is a pragmatic choice that allows lightweight in-memory providers to be synchronous without wrapping in `Promise.resolve()`. However, it requires callers to `await` results or check with `instanceof Promise` — most callers will simply `await` both, which works correctly.
- **`MemoryItem` vs `getRecentMessages` shape mismatch**: `MemoryItem` includes `role`, `content`, `interactionType`, and `timestamp`, but `getRecentMessages` returns `{ role: string; content: string }[]` — a subset. The `interactionType` and `timestamp` fields are stripped in the retrieval API, which is intentional for chat-API compatibility but means that information is not surfaced to the LLM.
- **`interactionType` is untyped**: Using `string` rather than a union type means there is no compile-time enforcement of valid values like `'direct' | 'overheard' | 'vision' | 'system'`. The comment in the source documents the expected values, but they are not enforced.
- **`MemoryQuery` is minimal**: Currently only `limit` is defined. The comment explicitly anticipates vector search and time-range queries, suggesting this interface was designed with planned growth in mind.
- **Extension point**: This file represents the intended abstraction boundary. If a new memory backend (e.g., a remote vector database) were added, it should implement this interface so that agents can use either backend interchangeably.
