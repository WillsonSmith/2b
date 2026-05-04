import type { ServerWebSocket } from "bun";
import type { ClientMsg } from "../../protocol.ts";
import { generateOutline } from "../../features/outline.ts";
import { transformTone } from "../../features/tone.ts";
import { summarizeSection } from "../../features/summarize.ts";
import { generateFrontmatter } from "../../features/metadata.ts";
import { generateNarrativeToc, extractSectionsFromMarkdown } from "../../features/toc.ts";
import { detectAutolinkCandidates } from "../../features/autolink.ts";
import { generateTable } from "../../features/table.ts";
import type { WsContext } from "../context.ts";

export type EditorMsg = Extract<
  ClientMsg,
  {
    type:
      | "editor_context"
      | "autocomplete_request"
      | "outline_request"
      | "tone_transform"
      | "summarize_request"
      | "metadata_request"
      | "toc_request"
      | "autolink_request"
      | "diagram_request"
      | "table_request"
      | "lint_request";
  }
>;

export async function handleEditor(
  msg: EditorMsg,
  ctx: WsContext,
  ws: ServerWebSocket<unknown>,
): Promise<void> {
  const { send, broadcast, editorContext, autocomplete, diagram, linter, config } = ctx;

  switch (msg.type) {
    case "editor_context":
      editorContext.setEditorState(msg.file, msg.content, msg.cursor);
      return;

    case "autocomplete_request": {
      if (!msg.context?.trim()) return;
      autocomplete.suggest(msg.context).then((text) => {
        if (text.trim()) send(ws, { type: "autocomplete_suggestion", text: text.trim() });
      }).catch(() => {});
      return;
    }

    case "outline_request": {
      const topic = msg.topic?.trim();
      if (!topic) return;
      generateOutline(topic, config).then((outline) => {
        broadcast({ type: "insert_text", text: outline });
      }).catch(() => {});
      return;
    }

    case "tone_transform": {
      const { text, tone, from, to } = msg;
      if (!text?.trim()) return;
      transformTone(text, tone, config).then((result) => {
        send(ws, { type: "tone_result", text: result.trim(), from, to });
      }).catch(() => {});
      return;
    }

    case "summarize_request": {
      const { text, insertPos } = msg;
      if (!text?.trim()) return;
      summarizeSection(text, config).then((result) => {
        send(ws, { type: "summarize_result", text: result.trim(), insertPos });
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
      const { markdown } = msg;
      if (!markdown?.trim()) return;
      const sections = extractSectionsFromMarkdown(markdown);
      generateNarrativeToc(sections, config).then((entries) => {
        send(ws, { type: "toc_result", entries });
      }).catch(() => {
        send(ws, { type: "error", message: "Failed to generate TOC." });
      });
      return;
    }

    case "autolink_request": {
      const { markdown, files } = msg;
      if (!markdown?.trim()) return;
      const suggestions = detectAutolinkCandidates(markdown, files ?? []);
      send(ws, { type: "autolink_result", suggestions });
      return;
    }

    case "diagram_request": {
      const { description, from, to } = msg;
      if (!description?.trim()) return;
      diagram.generate(description).then((code) => {
        send(ws, { type: "diagram_result", code, from, to });
      }).catch(() => {
        send(ws, { type: "error", message: "Failed to generate diagram." });
      });
      return;
    }

    case "table_request": {
      const { text, insertPos } = msg;
      if (!text?.trim()) return;
      generateTable(text, config).then((result) => {
        send(ws, { type: "table_result", text: result.trim(), insertPos });
      }).catch(() => {
        send(ws, { type: "error", message: "Failed to generate table." });
      });
      return;
    }

    case "lint_request": {
      const { content } = msg;
      if (!content?.trim()) return;
      linter.run(content).then((issues) => {
        send(ws, { type: "lint_result", issues });
      }).catch(() => {});
      return;
    }
  }
}
