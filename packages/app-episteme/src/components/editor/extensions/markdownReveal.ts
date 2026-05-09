import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const MARK_SYNTAX: Record<string, { open: string; close: string }> = {
  bold: { open: "**", close: "**" },
  italic: { open: "_", close: "_" },
  strike: { open: "~~", close: "~~" },
  code: { open: "`", close: "`" },
};

const pluginKey = new PluginKey("markdownReveal");

function buildDecorations(state: import("@tiptap/pm/state").EditorState): DecorationSet {
  const { doc, selection } = state;
  const { from, to } = selection;
  const decorations: Decoration[] = [];

  // Inline marks: scan all marks active anywhere in [from, to] range
  // For collapsed cursor we check the marks at `from` with stored marks too
  const seenMarkRanges = new Set<string>();

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (!node.isText) return;
    const nodeFrom = pos;
    const nodeTo = pos + node.nodeSize;

    for (const mark of node.marks) {
      const syntax = MARK_SYNTAX[mark.type.name];
      if (!syntax) continue;

      // Find the full contiguous extent of this mark
      let markFrom = nodeFrom;
      let markTo = nodeTo;

      // Walk backward to find mark start
      let probe = nodeFrom - 1;
      while (probe >= 0) {
        const $probe = doc.resolve(probe);
        const textNode = $probe.nodeAfter;
        if (!textNode || !textNode.isText) break;
        if (!textNode.marks.some((m) => m.type === mark.type)) break;
        markFrom = probe;
        probe -= textNode.nodeSize;
      }

      // Walk forward to find mark end
      probe = nodeTo;
      while (probe <= doc.content.size) {
        const $probe = doc.resolve(probe);
        const textNode = $probe.nodeAfter;
        if (!textNode || !textNode.isText) break;
        if (!textNode.marks.some((m) => m.type === mark.type)) break;
        markTo = probe + textNode.nodeSize;
        probe += textNode.nodeSize;
      }

      const key = `${mark.type.name}:${markFrom}:${markTo}`;
      if (seenMarkRanges.has(key)) continue;

      // Only reveal if cursor overlaps this mark range
      if (to < markFrom || from > markTo) continue;

      seenMarkRanges.add(key);

      const openSpan = document.createElement("span");
      openSpan.className = "md-syntax";
      openSpan.textContent = syntax.open;
      openSpan.setAttribute("contenteditable", "false");

      const closeSpan = document.createElement("span");
      closeSpan.className = "md-syntax";
      closeSpan.textContent = syntax.close;
      closeSpan.setAttribute("contenteditable", "false");

      decorations.push(Decoration.widget(markFrom, openSpan, { side: -1, key: key + ":open" }));
      decorations.push(Decoration.widget(markTo, closeSpan, { side: 1, key: key + ":close" }));

      // For links, append the href after the close bracket
      if (mark.type.name === "link") {
        const hrefSpan = document.createElement("span");
        hrefSpan.className = "md-syntax";
        hrefSpan.textContent = `(${mark.attrs.href ?? ""})`;
        hrefSpan.setAttribute("contenteditable", "false");
        decorations.push(Decoration.widget(markTo, hrefSpan, { side: 2, key: key + ":href" }));
      }
    }
  });

  // Headings: show # prefix when cursor is in a heading node
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (node.type.name !== "heading") return;
    const nodeFrom = pos + 1; // inside the node
    const nodeTo = pos + node.nodeSize - 1;
    if (to < nodeFrom || from > nodeTo) return;

    const level = (node.attrs.level as number) ?? 1;
    const prefix = "#".repeat(level) + " ";

    const headingSpan = document.createElement("span");
    headingSpan.className = "md-syntax md-syntax-heading";
    headingSpan.textContent = prefix;
    headingSpan.setAttribute("contenteditable", "false");

    decorations.push(Decoration.widget(nodeFrom, headingSpan, { side: -1, key: `heading:${pos}` }));
  });

  return DecorationSet.create(doc, decorations);
}

export const MarkdownRevealExtension = Extension.create({
  name: "markdownReveal",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init(_, state) {
            return buildDecorations(state);
          },
          apply(tr, _old, _prevState, newState) {
            if (tr.docChanged || tr.selectionSet) {
              return buildDecorations(newState);
            }
            return _old;
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state);
          },
        },
      }),
    ];
  },
});
