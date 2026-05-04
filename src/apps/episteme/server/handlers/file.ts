import type { ServerWebSocket } from "bun";
import { dirname } from "node:path";
import { rename as fsRename, mkdir } from "node:fs/promises";
import type { ClientMsg } from "../../protocol.ts";
import { detectAutolinkCandidates } from "../../features/autolink.ts";
import type { WsContext } from "../context.ts";


export type FileMsg = Extract<
  ClientMsg,
  { type: "list_workspace" | "file_open" | "file_save" | "file_create" | "file_rename" }
>;

export async function handleFile(
  msg: FileMsg,
  ctx: WsContext,
  ws: ServerWebSocket<unknown>,
): Promise<void> {
  const { send, absRoot, collectMarkdownFiles, resolveWorkspacePath } = ctx;

  switch (msg.type) {
    case "list_workspace": {
      const files = await collectMarkdownFiles();
      send(ws, { type: "workspace_files", files });
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
        await Bun.write(absolute, msg.content);
        send(ws, { type: "file_saved" });
        // Async autolink detection after save (lint runs on its own idle cadence)
        collectMarkdownFiles().then((files) => {
          const suggestions = detectAutolinkCandidates(msg.content, files);
          if (suggestions.length > 0) {
            send(ws, { type: "autolink_result", suggestions });
          }
        }).catch(() => {});
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
        const files = await collectMarkdownFiles();
        send(ws, { type: "workspace_files", files });
      } catch {
        send(ws, { type: "error", message: `Cannot create: ${msg.path}` });
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
        const files = await collectMarkdownFiles();
        send(ws, { type: "workspace_files", files });
      } catch {
        send(ws, { type: "error", message: `Cannot rename: ${msg.oldPath}` });
      }
      return;
    }
  }
}
