/**
 * Deterministic hash of a TOC section (heading + first 200 chars of content).
 * Pure function with no imports — safe for both server and browser bundles.
 */
export function sectionHash(heading: string, contentPreview: string): string {
  const s = `${heading}\x00${contentPreview.slice(0, 200)}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
