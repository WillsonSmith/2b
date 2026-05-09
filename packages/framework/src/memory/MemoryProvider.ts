/**
 * The role of a participant in the memory store.
 * Includes "agent" in addition to the core LLM roles to support
 * multi-agent and overheard-speech scenarios.
 */
export type MemoryRole = "user" | "agent" | "assistant" | "system";

export interface MemoryItem {
  id?: number | string;
  role: MemoryRole;
  content: string;
  interactionType: string; // e.g., 'direct', 'overheard', 'vision', 'system', etc.
  timestamp?: string;
}

// TODO: MemoryQuery is not yet referenced by MemoryProvider method signatures.
// When a concrete backend is added, extend methods to accept MemoryQuery
// (e.g. for vector search, timeframe filters, etc.) and remove the bare
// limit?: number parameters in favour of this type.
export interface MemoryQuery {
  limit?: number;
  // Can be extended later for vector search, timeframes, etc.
}

export interface MemoryProvider {
  /**
   * Adds a new message to the memory store.
   *
   * @param role - The role of the message author.
   * @param content - The message text.
   * @param interactionType - How the message was received. Defaults to
   *   `'direct'` in conforming implementations. Common values: `'direct'`,
   *   `'overheard'`, `'vision'`, `'system'`.
   */
  addMessage(
    role: MemoryRole,
    content: string,
    interactionType?: string
  ): Promise<void>;

  /**
   * Retrieves the most recent conversation context as a formatted string.
   */
  getRecentContext(limit?: number): Promise<string>;

  /**
   * Retrieves the most recent conversation as an array of messages for chat APIs.
   */
  getRecentMessages(limit?: number): Promise<{ role: string; content: string }[]>;
}
