import type { ServerWebSocket } from "bun";
import { dirname, join } from "node:path";
import { rename as fsRename, mkdir } from "node:fs/promises";
import type { ClientMsg } from "../../protocol.ts";
import type { WsContext } from "../context.ts";


export type FileMsg = Extract<
  ClientMsg,
  { type: "list_workspace" | "file_open" | "file_save" | "file_create" | "folder_create" | "folder_rename" | "file_rename" | "open_in_finder" }
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
        await mkdir(dirname(absNew), { recursive: true });
        await fsRename(absOld, absNew);
        await sendWorkspaceFiles();
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
      } catch {
        send(ws, { type: "error", message: `Cannot rename: ${msg.oldPath}` });
      }
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
