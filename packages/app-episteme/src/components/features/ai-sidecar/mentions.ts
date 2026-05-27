export function extractMentions(text: string): string[] {
  return [...text.matchAll(/@([\w\-./ ]+\.md)/g)].map((m) => m[1]!.trim());
}

export function getMentionQuery(value: string, cursor: number): string | null {
  const before = value.slice(0, cursor);
  const match = before.match(/@([\w\-./ ]*)$/);
  return match ? match[1] ?? null : null;
}

export function insertMention(
  value: string,
  cursor: number,
  filename: string,
): { text: string; newCursor: number } {
  const before = value.slice(0, cursor);
  const after = value.slice(cursor);
  const newBefore = before.replace(/@([\w\-./ ]*)$/, `@${filename} `);
  return { text: newBefore + after, newCursor: newBefore.length };
}
