export interface WikilinkSuggestion {
  text: string;
  filename: string;
  offset: number;
}

/**
 * Scan markdown for plain text that matches workspace file basenames.
 * Skips text already inside [[wikilinks]] or fenced code blocks.
 */
export function detectAutolinkCandidates(
  markdown: string,
  workspaceFiles: string[],
): WikilinkSuggestion[] {
  // Collect already-linked names to skip
  const existingLinks = new Set<string>();
  for (const m of markdown.matchAll(/\[\[([^\]]+)\]\]/g)) {
    existingLinks.add((m[1] ?? "").toLowerCase());
  }

  // Strip fenced code blocks from search target (keep offsets aligned via blank lines)
  const stripped = markdown.replace(/```[\s\S]*?```/g, (match) =>
    " ".repeat(match.length),
  );

  // Build candidate list: basename without .md, min 3 chars, not already linked
  const candidates = workspaceFiles
    .map((f) => {
      const base = (f.split("/").at(-1) ?? f).replace(/\.md$/i, "");
      return { name: base, path: f };
    })
    .filter(({ name }) => name.length >= 3 && !existingLinks.has(name.toLowerCase()));

  const suggestions: WikilinkSuggestion[] = [];
  const seen = new Set<string>();

  for (const { name, path } of candidates) {
    const re = new RegExp(`(?<!\\[\\[)\\b(${escapeRegex(name)})\\b(?!\\]\\])`, "gi");
    for (const m of stripped.matchAll(re)) {
      const key = `${(m[1] ?? "").toLowerCase()}:${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({
        text: m[1] ?? "",
        filename: path,
        offset: m.index ?? 0,
      });
      if (suggestions.length >= 10) break;
    }
    if (suggestions.length >= 10) break;
  }

  return suggestions;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
