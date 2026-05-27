export function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function dirname(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}
