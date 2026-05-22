import { Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

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
  return new ProseMirrorPlugin({
    key: punctKey,
    state: {
      init: (_, { doc }) => buildDecorations(doc, getEnabled()),
      apply(tr, old, _oldState, newState) {
        if (tr.getMeta("punctuation-highlight-refresh")) {
          return buildDecorations(newState.doc, getEnabled());
        }
        if (tr.docChanged) {
          return buildDecorations(newState.doc, getEnabled());
        }
        return old;
      },
    },
    props: {
      decorations: (state) => punctKey.getState(state) ?? DecorationSet.empty,
    },
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
