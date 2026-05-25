import type { ServerWebSocket } from "bun";
import type { ClientMsg } from "../../protocol.ts";
import { generateFrontmatter } from "../../features/metadata.ts";
import { generateNarrativeToc, extractSectionsFromMarkdown } from "../../features/toc.ts";
import type { WsContext } from "../context.ts";

export type EditorMsg = Extract<
  ClientMsg,
  {
    type:
      | "editor_context"
      | "autocomplete_request"
      | "metadata_request"
      | "toc_request"
      | "diagram_request";
  }
>;

export async function handleEditor(
  msg: EditorMsg,
  ctx: WsContext,
  ws: ServerWebSocket<unknown>,
): Promise<void> {
  const { send, editorContext, autocomplete, diagram, config, workspaceDb } = ctx;

  switch (msg.type) {
    case "editor_context":
      editorContext.setEditorState(msg.file, msg.content, msg.cursor);
      return;

    case "autocomplete_request": {
      if (!msg.context?.trim()) return;
      // Autocomplete is high-frequency and noisy on backend errors —
      // staying silent is fine; the global provider banner already covers
      // the "Ollama is down" case for the user.
      autocomplete.suggest(msg.context).then((text) => {
        if (text.trim()) send(ws, { type: "autocomplete_suggestion", text: text.trim() });
      }).catch(() => {});
      return;
    }

    case "metadata_request": {
      const { title, preview } = msg;
      if (!preview?.trim() && !title?.trim()) return;
      generateFrontmatter(title ?? "", preview ?? "", config).then((yaml) => {
        send(ws, { type: "metadata_result", yaml });
      }).catch(() => {
        send(ws, { type: "error", message: "Failed to generate frontmatter." });
      });
      return;
    }

    case "toc_request": {
      const { markdown, file } = msg;
      if (!markdown?.trim()) return;
      const sections = extractSectionsFromMarkdown(markdown);
      generateNarrativeToc(sections, config).then((entries) => {
        send(ws, { type: "toc_result", entries });
        if (file) {
          workspaceDb.saveTocEntries(file, entries.map((e) => ({
            headingText: e.text,
            description: e.description,
            contentHash: e.contentHash ?? "",
          })));
        }
      }).catch(() => {
        send(ws, { type: "error", message: "Failed to generate TOC." });
      });
      return;
    }

    case "diagram_request": {
      const { description, placeholderId } = msg;
      if (!description?.trim()) return;
      const docContent = editorContext.activeContent ?? undefined;
      diagram.generate(description, docContent).then((code) => {
        send(ws, { type: "diagram_result", code, placeholderId });
      }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to generate diagram.";
        // Send the failure to the placeholder owner so it can render an
        // inline error + retry, rather than emitting a generic chat error
        // that leaves the "Generating diagram…" spinner stuck forever.
        send(ws, { type: "diagram_result", code: "", placeholderId, error: message });
      });
      return;
    }
  }
}
