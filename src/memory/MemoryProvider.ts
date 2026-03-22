export interface MemoryItem {
  id?: number | string;
  role: "user" | "agent" | "assistant" | "system";
  content: string;
  interactionType: string; // e.g., 'direct', 'overheard', 'vision', 'system', etc.
  timestamp?: string;
}

export interface MemoryQuery {
  limit?: number;
  // Can be extended later for vector search, timeframes, etc.
}

export interface MemoryProvider {
  /**
   * Adds a new message to the memory store.
   */
  addMessage(
    role: "user" | "agent" | "assistant" | "system",
    content: string,
    interactionType?: string
  ): Promise<void> | void;

  /**
   * Retrieves the most recent conversation context as a formatted string.
   */
  getRecentContext(limit?: number): Promise<string> | string;

  /**
   * Retrieves the most recent conversation as an array of messages for chat APIs.
   */
  getRecentMessages(limit?: number): Promise<{ role: string; content: string }[]> | { role: string; content: string }[];
}
