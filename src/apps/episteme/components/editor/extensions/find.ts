import { Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export interface FindMatch { from: number; to: number; }
export interface FindState { matches: FindMatch[]; activeIndex: number; }

const findKey = new PluginKey<DecorationSet>("find-decos");

export function buildFindPlugin(getState: () => FindState) {
  return new ProseMirrorPlugin({
    key: findKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        if (tr.getMeta("find-refresh")) {
          const { matches, activeIndex } = getState();
          if (!matches.length) return DecorationSet.empty;
          const decos = matches.map((m, i) =>
            Decoration.inline(m.from, m.to, {
              class: i === activeIndex ? "find-match find-match-active" : "find-match",
            }),
          );
          return DecorationSet.create(tr.doc, decos);
        }
        if (tr.docChanged) return old.map(tr.mapping, tr.doc);
        return old;
      },
    },
    props: {
      decorations: (state) => findKey.getState(state) ?? DecorationSet.empty,
    },
  });
}

export function FindExtension(stateRef: React.MutableRefObject<FindState>) {
  return Extension.create({
    name: "find",
    addProseMirrorPlugins() {
      return [buildFindPlugin(() => stateRef.current)];
    },
  });
}

export function resolveFindMatches(doc: ProseMirrorNode, query: string, caseSensitive: boolean): FindMatch[] {
  if (!query) return [];
  const chars: string[] = [];
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        chars.push(node.text[i] ?? "");
        positions.push(pos + i);
      }
    }
  });
  const haystack = caseSensitive ? chars.join("") : chars.join("").toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches: FindMatch[] = [];
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    const from = positions[idx] ?? 0;
    const to = (positions[idx + needle.length - 1] ?? 0) + 1;
    matches.push({ from, to });
    idx += Math.max(needle.length, 1);
  }
  return matches;
}
