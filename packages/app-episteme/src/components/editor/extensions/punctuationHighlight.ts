import { Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { createDebouncedDecorationPlugin } from "./debouncedDecorations.ts";

const punctKey = new PluginKey<DecorationSet>("punctuation-highlight");
const PUNCT_REGEX = /[.,;:!?—–"'()[\]{}]/g;

function buildDecorations(doc: ProseMirrorNode, enabled: boolean): DecorationSet {
  if (!enabled) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const text = node.text;
    let match: RegExpExecArray | null;
    PUNCT_REGEX.lastIndex = 0;
    while ((match = PUNCT_REGEX.exec(text)) !== null) {
      const from = pos + match.index;
      const to = from + match[0].length;
      decos.push(Decoration.inline(from, to, { class: "punct" }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export function buildPunctuationHighlightPlugin(getEnabled: () => boolean) {
  return createDebouncedDecorationPlugin({
    key: punctKey,
    refreshMeta: "punctuation-highlight-refresh",
    build: (state) => buildDecorations(state.doc, getEnabled()),
  });
}

export function PunctuationHighlightExtension(
  enabledRef: React.MutableRefObject<boolean>,
) {
  return Extension.create({
    name: "punctuationHighlight",
    addProseMirrorPlugins() {
      return [buildPunctuationHighlightPlugin(() => enabledRef.current)];
    },
  });
}
