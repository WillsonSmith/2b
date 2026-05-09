export const WIKILINK_RE = /\[\[([^\]|\n]+?)(?:\|([^\]\n]+))?\]\]/g;

export interface WikilinkMatch {
  raw: string;
  target: string;
  alias: string | null;
  offset: number;
}

export function findWikilinks(text: string): WikilinkMatch[] {
  const out: WikilinkMatch[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    out.push({
      raw: m[0],
      target: (m[1] ?? "").trim(),
      alias: m[2] ? m[2].trim() : null,
      offset: m.index ?? 0,
    });
  }
  return out;
}

/**
 * Resolve a wikilink target name against the workspace file list.
 * Prefers shortest path (fewest segments, then shortest length) on basename collisions.
 * Returns the matching file path, or null if no file matches.
 */
export function resolveWikilinkTarget(
  name: string,
  files: string[],
): string | null {
  const cleaned = name.replace(/\.md$/i, "").trim();
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  const hasSlash = cleaned.includes("/");

  const matches = files.filter((f) => {
    if (!f.toLowerCase().endsWith(".md")) return false;
    if (hasSlash) {
      const fl = f.toLowerCase();
      return fl === lower + ".md" || fl.endsWith("/" + lower + ".md");
    }
    const base = (f.split("/").at(-1) ?? f).replace(/\.md$/i, "");
    return base.toLowerCase() === lower;
  });

  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const segA = a.split("/").length;
    const segB = b.split("/").length;
    if (segA !== segB) return segA - segB;
    return a.length - b.length;
  });
  return matches[0] ?? null;
}

/** Path (relative to workspace root) to create for a broken wikilink. */
export function wikilinkCreatePath(name: string): string {
  return name.replace(/\.md$/i, "").trim() + ".md";
}

export interface WikilinkSuggestionItem {
  path: string;
  basename: string;
}

/**
 * Rank workspace files for a `[[query` autocomplete popup.
 * Order: exact basename > basename prefix > basename substring > path substring.
 * Within a tier, shortest path wins (fewest segments, then shortest length).
 */
export function rankFilesForWikilink(
  files: string[],
  query: string,
  limit = 10,
): WikilinkSuggestionItem[] {
  const q = query.trim().toLowerCase();
  const scored: { path: string; basename: string; score: number }[] = [];

  for (const f of files) {
    if (!f.toLowerCase().endsWith(".md")) continue;
    const basename = (f.split("/").at(-1) ?? f).replace(/\.md$/i, "");
    const lb = basename.toLowerCase();
    const lf = f.toLowerCase();

    let score: number;
    if (q === "") score = 4;
    else if (lb === q) score = 0;
    else if (lb.startsWith(q)) score = 1;
    else if (lb.includes(q)) score = 2;
    else if (lf.includes(q)) score = 3;
    else continue;

    scored.push({ path: f, basename, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    const segA = a.path.split("/").length;
    const segB = b.path.split("/").length;
    if (segA !== segB) return segA - segB;
    return a.basename.length - b.basename.length;
  });

  return scored.slice(0, limit).map(({ path, basename }) => ({ path, basename }));
}
