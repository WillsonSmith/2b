// Browser-compatible link utilities for standard markdown links.
// No node:path dependency — safe to import in both editor and SSG contexts.

export interface LinkSuggestionItem {
  path: string;
  basename: string;
}

export interface BacklinkItem {
  sourcePath: string;
  snippet: string;
}

export function isLocalLink(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("http://") || href.startsWith("https://")) return false;
  if (href.startsWith("mailto:")) return false;
  if (href.startsWith("#")) return false;
  if (href.startsWith("//")) return false;
  return true;
}

function ldirname(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/") || ".";
}

function lnormalize(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
    } else if (part !== ".") {
      out.push(part);
    }
  }
  return out.join("/");
}

function ljoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function lrelative(from: string, to: string): string {
  const fp = from.split("/").filter(Boolean);
  const tp = to.split("/").filter(Boolean);
  let i = 0;
  while (i < fp.length && i < tp.length && fp[i] === tp[i]) i++;
  const ups = fp.slice(i).map(() => "..");
  const downs = tp.slice(i);
  return [...ups, ...downs].join("/") || ".";
}

/**
 * Resolve a local href (relative to currentFilePath's directory) against the
 * workspace file list. Returns the workspace-relative path of the target, or
 * null if it does not exist in the workspace.
 */
export function resolveLocalHref(
  href: string,
  currentFilePath: string,
  allFiles: string[],
): string | null {
  if (!isLocalLink(href)) return null;
  const [hrefNoFrag] = href.split("#");
  if (!hrefNoFrag) return null;

  const dir = ldirname(currentFilePath);
  const raw = lnormalize(dir === "." ? hrefNoFrag : ljoin(dir, hrefNoFrag));

  if (allFiles.includes(raw)) return raw;
  const withMd = raw.endsWith(".md") ? raw : raw + ".md";
  if (allFiles.includes(withMd)) return withMd;

  return null;
}

/**
 * Compute the relative href to insert when linking from fromFile to toFile.
 * Both paths are workspace-relative (e.g. "notes/a.md", "other/b.md").
 */
export function computeRelativeHref(fromFile: string, toFile: string): string {
  const dir = ldirname(fromFile);
  return lrelative(dir === "." ? "" : dir, toFile);
}

/**
 * Rank workspace files for link autocomplete. Same scoring as the old wikilink
 * ranking: exact basename > prefix > substring > path substring.
 */
export function rankFilesForLink(
  files: string[],
  query: string,
  limit = 10,
): LinkSuggestionItem[] {
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

/**
 * Rewrite [text](href) links in content that point to oldTargetPath so they
 * instead point to newTargetPath. Used after a file rename.
 *
 * sourceFilePath is the file whose content is being rewritten (workspace-relative).
 * All three path args are workspace-relative.
 */
export function rewriteLinksForRename(
  content: string,
  sourceFilePath: string,
  oldTargetPath: string,
  newTargetPath: string,
): string {
  return content.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (match, text: string, href: string) => {
    if (!isLocalLink(href)) return match;
    const [hrefNoFrag, frag] = href.split("#") as [string, string | undefined];
    const dir = ldirname(sourceFilePath);
    const raw = lnormalize(dir === "." ? hrefNoFrag : ljoin(dir, hrefNoFrag));
    const resolved = raw.endsWith(".md") ? raw : raw + ".md";
    const normalOld = oldTargetPath.endsWith(".md") ? oldTargetPath : oldTargetPath + ".md";
    if (resolved !== normalOld) return match;
    const newHref = computeRelativeHref(sourceFilePath, newTargetPath);
    return `[${text}](${newHref}${frag ? "#" + frag : ""})`;
  });
}
