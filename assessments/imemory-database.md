# IMemoryDatabase Assessment

## Module Overview

`IMemoryDatabase` is a TypeScript interface (contract) that defines the required API surface for any memory storage backend used in the agent system. It specifies two operations: storing a memory (text → embedding → database) and retrieving semantically similar memories (query → embedding → similarity search → ranked results). The interface exists to decouple memory plugin implementations from specific embedding and storage backends, enabling different database implementations to be swapped in without changing plugin code.

## Interface / Exports

### `interface IMemoryDatabase`

Exported as a named interface. No classes, constants, or functions are exported.

```typescript
export interface IMemoryDatabase {
  addMemory(text: string): Promise<void>;
  search(query: string, limit?: number, threshold?: number): Promise<string[]>;
}
```

#### `addMemory(text: string): Promise<void>`
- Accepts a plain text string representing the memory to store.
- Implementations are expected to generate an embedding for the text and persist both the text and embedding to the database.
- Returns `void` — the caller receives no confirmation of the stored record ID or any metadata.
- Throws (or rejects) on failure; the interface makes no guarantee about error types.

#### `search(query: string, limit?: number, threshold?: number): Promise<string[]>`
- Accepts a query string for semantic similarity search.
- `limit`: maximum number of results to return. Optional; implementations define their own default.
- `threshold`: minimum similarity score to qualify as a match (e.g., `0.7` for cosine similarity on a 0–1 scale). Optional; implementations define their own default.
- Returns an array of plain text strings — the matched memory texts in relevance order.
- Returns an empty array when no memories meet the threshold; does not throw in the no-results case (by convention, though the interface does not enforce this).

## Configuration

None. The interface itself has no configuration, environment variables, or external dependencies. Those concerns belong entirely to implementing classes.

## Data Flow

The interface defines a two-stage model:

```
addMemory:  text → [embed] → [store embedding + text] → void
search:     query → [embed] → [similarity search] → [filter by threshold] → [limit results] → string[]
```

The bracketed steps are implementation details invisible at the interface level. The interface only specifies inputs and outputs.

## Code Paths

The interface has no code paths of its own. Implementations must fulfill the contract:

1. **Write path (`addMemory`):** Expected to be idempotent or append-only depending on implementation. The interface does not specify deduplication behavior.
2. **Read path (`search`):** Expected to return results sorted by descending similarity. The interface does not state this guarantee explicitly, but the JSDoc comment implies it ("most similar").

## Helper Functions / Internals

None. This is a pure interface definition — 15 lines of TypeScript with no implementation code.

## Error Handling

The interface does not specify error handling behavior. Implementing classes determine:
- What happens when `addMemory` fails (embedding service down, database write error).
- What happens when `search` finds no results (return `[]` vs. throw).
- Whether `threshold` out-of-range values are clamped, rejected, or silently ignored.

## Integration Context

**Defined in:** `src/plugins/IMemoryDatabase.ts`

**Implemented by:** As of the current codebase, no file contains `implements IMemoryDatabase`. The interface is defined but has no concrete implementations present in the repository. It is intended for use by memory-related plugins that use vector/embedding search.

**Depends on:** Nothing — the file has no imports.

**Intended usage pattern:**
```typescript
class SomeMemoryPlugin implements AgentPlugin {
  constructor(private db: IMemoryDatabase) {}
  // plugin uses this.db.addMemory() and this.db.search()
}
```

A plugin receives an `IMemoryDatabase` implementation at construction time, enabling dependency injection and testability.

## Observations / Notes

1. **No concrete implementations exist in the repository.** The interface is defined but currently unused. It may be a forward-looking abstraction for a planned memory backend, or an artifact of a refactoring that removed the implementation without removing the interface.

2. **`addMemory` returns `void`, not the stored record.** Callers cannot obtain the ID or metadata of what was stored. This simplifies the interface but makes it impossible to retrieve a specific memory by ID or link memories to one another without a richer return type.

3. **`search` returns raw text strings, not structured records.** Callers receive the memory text but not associated metadata (e.g., timestamp, source, similarity score). If a caller needs to know how relevant a result was, that information is not available from the return value.

4. **No `delete` or `update` operations.** The interface is append-and-search only. Editing or removing memories would require either a separate interface or an extension of this one.

5. **No pagination beyond `limit`.** The `search` method supports a `limit` parameter but not an `offset` or cursor. Clients cannot page through results beyond the initial batch.

6. **Embedding strategy is fully implementation-defined.** The interface makes no assumption about embedding dimensionality, model, or similarity metric. Implementations using different embedding models would produce incompatible vectors if a database were shared — but this is a concern for implementations, not the interface itself.

7. **The JSDoc is informative and well-written.** The parameter descriptions clearly communicate intent (e.g., `threshold` with the `0.7` example). This is good practice for an interface intended to be implemented by multiple backends.
