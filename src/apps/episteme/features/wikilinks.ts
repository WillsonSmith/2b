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
