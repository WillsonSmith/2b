import type { ServerWebSocket } from "bun";
import { dirname, join, normalize } from "node:path";
import { rename as fsRename, mkdir } from "node:fs/promises";
import type { ClientMsg } from "../../protocol.ts";
import type { WsContext } from "../context.ts";
import { rewriteLinksForRename, isLocalLink } from "../../features/links.ts";
import type { BacklinkItem } from "../../features/links.ts";

const MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]*)\)/g;

async function rewriteLinksAfterRename(
  absRoot: string,
  oldRelPath: string,
  newRelPath: string,
  collectMarkdownFiles: () => Promise<string[]>,
): Promise<void> {
  const files = await collectMarkdownFiles();
  for (const relPath of files) {
    if (relPath === newRelPath) continue; // skip the renamed file itself
    const absPath = join(absRoot, relPath);
    try {
      const original = await Bun.file(absPath).text();
      const rewritten = rewriteLinksForRename(original, relPath, oldRelPath, newRelPath);
      if (rewritten !== original) {
        await Bun.write(absPath, rewritten);
      }
    } catch {
      // skip unreadable files
    }
  }
}

async function scanBacklinks(
  absRoot: string,
  targetRelPath: string,
  collectMarkdownFiles: () => Promise<string[]>,
): Promise<BacklinkItem[]> {
  const files = await collectMarkdownFiles();
  const results: BacklinkItem[] = [];

  for (const relPath of files) {
    if (relPath === targetRelPath) continue;
    const absPath = join(absRoot, relPath);
    try {
      const content = await Bun.file(absPath).text();
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        for (const m of line.matchAll(new RegExp(MARKDOWN_LINK_RE.source, "g"))) {
          const href = m[2];
          if (!href || !isLocalLink(href)) continue;
          // Resolve href relative to relPath's directory
          const sourceDir = dirname(relPath);
          const resolved = normalize(
            sourceDir === "." ? href.replace(/\.md$/i, "") : join(sourceDir, href.replace(/\.md$/i, "")),
          ).replace(/\\/g, "/");
          const resolvedWithMd = resolved.endsWith(".md") ? resolved : resolved + ".md";
          if (resolvedWithMd === targetRelPath) {
            const snippet = line.trim().slice(0, 200);
            results.push({ sourcePath: relPath, snippet });
            break; // one result per line is enough; move to next line
          }
        }
      }
    } catch {
      // skip unreadable files
    }
  }

  return results;
}

export type FileMsg = Extract<
  ClientMsg,
  { type: "list_workspace" | "file_open" | "file_save" | "file_create" | "folder_create" | "folder_rename" | "file_rename" | "open_in_finder" | "backlinks_request" }
>;

export async function handleFile(
  msg: FileMsg,
  ctx: WsContext,
  ws: ServerWebSocket<unknown>,
): Promise<void> {
  const { send, absRoot, collectMarkdownFiles, collectSubdirectories, resolveWorkspacePath, workspaceDb, suppressExternalChange } = ctx;

  async function sendWorkspaceFiles() {
    const [files, folders] = await Promise.all([collectMarkdownFiles(), collectSubdirectories()]);
    send(ws, { type: "workspace_files", files, folders });
  }

  switch (msg.type) {
    case "list_workspace": {
      await sendWorkspaceFiles();
      return;
    }

    case "file_open": {
      const absolute = resolveWorkspacePath(msg.path);
      if (!absolute) {
        send(ws, { type: "error", message: "Path escapes workspace boundary." });
        return;
      }
      try {
        const content = await Bun.file(absolute).text();
        send(ws, { type: "file_content", path: msg.path, content });
        const stored = workspaceDb.loadTocEntries(msg.path);
        if (stored.length > 0) {
          send(ws, {
            type: "toc_stored",
            file: msg.path,
            entries: stored.map((e) => ({
              level: 0,
              text: e.headingText,
              description: e.description,
              id: "",
              contentHash: e.contentHash,
            })),
          });
        }
      } catch {
        send(ws, { type: "error", message: `Cannot open: ${msg.path}` });
      }
      return;
    }

    case "file_save": {
      const absolute = resolveWorkspacePath(msg.path);
      if (!absolute) {
        send(ws, { type: "error", message: "Path escapes workspace boundary." });
        return;
      }
      try {
        suppressExternalChange(absolute);
        await Bun.write(absolute, msg.content);
        send(ws, { type: "file_saved" });
      } catch {
        send(ws, { type: "error", message: `Cannot save: ${msg.path}` });
      }
      return;
    }

    case "file_create": {
      const absolute = resolveWorkspacePath(msg.path);
      if (!absolute) {
        send(ws, { type: "error", message: "Path escapes workspace boundary." });
        return;
      }
      try {
        const file = Bun.file(absolute);
        if (await file.exists()) {
          send(ws, { type: "error", message: `File already exists: ${msg.path}` });
          return;
        }
        await mkdir(dirname(absolute), { recursive: true });
        await Bun.write(absolute, "");
        const relPath = absolute.slice(absRoot.length + 1);
        send(ws, { type: "file_created", path: relPath });
        await sendWorkspaceFiles();
      } catch {
        send(ws, { type: "error", message: `Cannot create: ${msg.path}` });
      }
      return;
    }

    case "folder_create": {
      const absolute = resolveWorkspacePath(msg.path);
      if (!absolute) {
        send(ws, { type: "error", message: "Path escapes workspace boundary." });
        return;
      }
      try {
        await mkdir(absolute, { recursive: true });
        await sendWorkspaceFiles();
      } catch {
        send(ws, { type: "error", message: `Cannot create folder: ${msg.path}` });
      }
      return;
    }

    case "folder_rename": {
      const absOld = resolveWorkspacePath(msg.oldPath);
      const absNew = resolveWorkspacePath(msg.newPath);
      if (!absOld || !absNew) {
        send(ws, { type: "error", message: "Path escapes workspace boundary." });
        return;
      }
      try {
        // Collect files inside the old folder before the rename
        const allBefore = await collectMarkdownFiles();
        const oldFolderPrefix = msg.oldPath.endsWith("/") ? msg.oldPath : msg.oldPath + "/";
        const movedFiles = allBefore.filter((f) => f.startsWith(oldFolderPrefix));

        await mkdir(dirname(absNew), { recursive: true });
        await fsRename(absOld, absNew);
        await sendWorkspaceFiles();

        // Rewrite links for each file that moved
        const newFolderPrefix = msg.newPath.endsWith("/") ? msg.newPath : msg.newPath + "/";
        for (const oldRelPath of movedFiles) {
          const newRelPath = newFolderPrefix + oldRelPath.slice(oldFolderPrefix.length);
          await rewriteLinksAfterRename(absRoot, oldRelPath, newRelPath, collectMarkdownFiles);
        }
      } catch {
        send(ws, { type: "error", message: `Cannot move folder: ${msg.oldPath}` });
      }
      return;
    }

    case "file_rename": {
      const absOld = resolveWorkspacePath(msg.oldPath);
      const absNew = resolveWorkspacePath(msg.newPath);
      if (!absOld || !absNew) {
        send(ws, { type: "error", message: "Path escapes workspace boundary." });
        return;
      }
      try {
        await mkdir(dirname(absNew), { recursive: true });
        await fsRename(absOld, absNew);
        const relOld = absOld.slice(absRoot.length + 1);
        const relNew = absNew.slice(absRoot.length + 1);
        send(ws, { type: "file_renamed", oldPath: relOld, newPath: relNew });
        await sendWorkspaceFiles();
        // Rewrite links in all other files that pointed to the old path
        await rewriteLinksAfterRename(absRoot, relOld, relNew, collectMarkdownFiles);
      } catch {
        send(ws, { type: "error", message: `Cannot rename: ${msg.oldPath}` });
      }
      return;
    }

    case "backlinks_request": {
      const targetRel = msg.path;
      const items = await scanBacklinks(absRoot, targetRel, collectMarkdownFiles);
      send(ws, { type: "backlinks_result", path: targetRel, items });
      return;
    }

    case "open_in_finder": {
      const absolute = resolveWorkspacePath(msg.path) ?? join(absRoot, msg.path);
      try {
        await Bun.$`open -R ${absolute}`.quiet();
      } catch {
        // Silently fail on non-macOS or missing file
      }
      return;
    }
  }
}
