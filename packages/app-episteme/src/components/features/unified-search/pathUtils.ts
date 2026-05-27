export function basename(path: string): string {
  return path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path;
}

export function dirpart(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

export function fuzzyMatch(pattern: string, str: string): boolean {
  const p = pattern.toLowerCase();
  const s = str.toLowerCase();
  let pi = 0;
  for (let i = 0; i < s.length && pi < p.length; i++) {
    if (s[i] === p[pi]) pi++;
  }
  return pi === p.length;
}
