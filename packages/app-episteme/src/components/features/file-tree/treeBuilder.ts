import { basename, dirname } from "./pathUtils.ts";

export type TreeItem =
  | { type: "dir"; label: string; path: string; depth: number }
  | { type: "file"; label: string; path: string; depth: number }
  | { type: "new-file-in-dir"; dirPath: string; depth: number }
  | { type: "new-folder-in-dir"; dirPath: string; depth: number };

export function buildItems(
  files: ReadonlyArray<string>,
  folders: ReadonlyArray<string>,
  expandedDirs: Set<string>,
  creatingInDir: string | null,
  creatingFolderInDir: string | null,
): TreeItem[] {
  const result: TreeItem[] = [];

  const allDirPaths = new Set<string>();
  for (const f of files) {
    let d = dirname(f);
    while (d) { allDirPaths.add(d); d = dirname(d); }
  }
  for (const folder of folders) {
    let d = folder;
    while (d) { allDirPaths.add(d); d = dirname(d); }
  }

  const filesByDir = new Map<string, string[]>();
  for (const f of files) {
    const d = dirname(f);
    const bucket = filesByDir.get(d) ?? [];
    bucket.push(f);
    filesByDir.set(d, bucket);
  }

  function getChildDirs(parentPath: string): string[] {
    return [...allDirPaths]
      .filter((d) =>
        parentPath === ""
          ? !d.includes("/")
          : d.startsWith(parentPath + "/") && !d.slice(parentPath.length + 1).includes("/"),
      )
      .sort();
  }

  function addDir(dirPath: string, depth: number) {
    result.push({ type: "dir", label: basename(dirPath) + "/", path: dirPath, depth });
    if (!expandedDirs.has(dirPath)) return;

    if (creatingFolderInDir === dirPath)
      result.push({ type: "new-folder-in-dir", dirPath, depth: depth + 1 });
    if (creatingInDir === dirPath)
      result.push({ type: "new-file-in-dir", dirPath, depth: depth + 1 });

    for (const child of getChildDirs(dirPath)) addDir(child, depth + 1);
    for (const f of filesByDir.get(dirPath) ?? [])
      result.push({ type: "file", label: basename(f), path: f, depth: depth + 1 });
  }

  for (const f of filesByDir.get("") ?? [])
    result.push({ type: "file", label: basename(f), path: f, depth: 0 });

  for (const dir of getChildDirs("")) addDir(dir, 0);

  return result;
}
