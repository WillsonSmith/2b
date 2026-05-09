// IMemoryDatabase.ts
export interface IMemoryDatabase {
  /**
   * Generates an embedding for the text and stores it in the database.
   */
  addMemory(text: string): Promise<void>;

  /**
   * Searches the database for memories most similar to the query.
   * @param query The text to search for.
   * @param limit Maximum number of results to return.
   * @param threshold Minimum similarity score (e.g., 0.7).
   */
  search(query: string, limit?: number, threshold?: number): Promise<string[]>;
}
